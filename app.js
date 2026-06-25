// DOM wiring: state, persistence, rendering. All math lives in rebalance.js.
const $ = id => document.getElementById(id);
const KEY = "rebalc_v3";
const fmt = (n, d = 2) => (isFinite(n) ? n : 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

const blank = (name = "") => ({ name, w: "", t: "", ccy: "" });
let state = load() || { C: "", unit: "pct", noSell: true, capOn: false, cap: "", base: "CHF", rows: [blank("Asset 1"), blank("Asset 2")] };
if (state.noSell === undefined) state.noSell = true;
if (!state.base) state.base = "CHF";

// --- Currency / live FX (ECB daily rates via Frankfurter, keyless + CORS) ---
const CURRENCIES = ["CHF", "USD", "EUR", "GBP", "JPY", "CAD", "AUD", "SEK", "NOK", "DKK", "CNY", "HKD", "SGD"];
let fxRates = null, fxDate = null;                 // fxRates[X] = units of X per 1 base
const rowCcy = r => (r.ccy && String(r.ccy).trim()) ? r.ccy : state.base;
const ccyOptions = sel => CURRENCIES.map(c => `<option value="${c}"${c === sel ? " selected" : ""}>${c}</option>`).join("");

async function fetchRates() {
  const base = state.base;
  $("fxstatus").textContent = "loading…";
  try {
    const r = await fetch("https://api.frankfurter.dev/v1/latest?base=" + encodeURIComponent(base));
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    fxRates = d.rates || {}; fxRates[base] = 1; fxDate = d.date;
    $("fxstatus").textContent = "1 " + base + " · ECB " + fxDate;
  } catch (e) {
    fxRates = null;
    $("fxstatus").textContent = "rates unavailable — amounts shown in " + base;
  }
  paint();
}
// Convert a base-currency amount into ccy. null = no rate available.
const conv = (amtBase, ccy) => {
  if (ccy === state.base) return amtBase;
  if (!fxRates || fxRates[ccy] == null) return null;
  return amtBase * fxRates[ccy];
};
// Format a base-currency trade, appending the asset-currency order size.
function money(amtBase, ccy) {
  const b = fmt(Math.abs(amtBase)) + " " + state.base;
  if (ccy === state.base) return b;
  const c = conv(Math.abs(amtBase), ccy);
  return b + (c == null ? "" : " (≈ " + fmt(c) + " " + ccy + ")");
}

function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
const esc = s => String(s).replace(/"/g, "&quot;");
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const hasTarget = r => String(r.t).trim() !== "";
const div = () => (state.unit === "pct" ? 100 : 1);

function render() {
  $("C").value = state.C; $("unit").value = state.unit;
  $("base").innerHTML = ccyOptions(state.base);
  $("noSell").checked = !!state.noSell;
  $("capOn").checked = !!state.capOn; $("cap").value = state.cap; $("cap").disabled = !state.capOn;
  const box = $("rows"); box.innerHTML = "";
  state.rows.forEach((r, i) => {
    const el = document.createElement("div");
    el.className = "asset" + (hasTarget(r) ? "" : " hold");
    el.innerHTML = `
      <div class="arow">
        <input class="name" data-i="${i}" data-k="name" placeholder="Name" value="${esc(r.name)}">
        <select class="ccy" data-i="${i}" data-k="ccy" style="width:auto;flex:0 0 auto;padding:8px;font-size:14px">${ccyOptions(rowCcy(r))}</select>
        <button class="del" data-del="${i}" aria-label="Remove">×</button>
      </div>
      <div class="fields">
        <div class="fld"><label>Now w</label>
          <input class="num" data-i="${i}" data-k="w" inputmode="decimal" placeholder="0" value="${esc(r.w)}"></div>
        <div class="fld"><label>Target t</label>
          <input class="num" data-i="${i}" data-k="t" inputmode="decimal" placeholder="hold" value="${esc(r.t)}"></div>
      </div>
      <div class="res">
        <span class="x" id="x${i}">—</span>
        <span class="endw"><b id="f${i}">—</b><small id="g${i}"></small></span>
      </div>
      <div class="bar"><div class="fill" id="bf${i}"></div><div class="tick" id="bt${i}" style="display:none"></div></div>`;
    box.appendChild(el);
  });
  paint();
}

const FEE = 2; // base-currency buffer reserved per suggested trade (IBKR-style)
const ACTION_LABEL = {
  "hold-blank": "hold",
  "hold-nosell": "held — no sell",
  "hold-cap": "held — cap",
  "hold-over": "held — above tgt",
  "hold-on-target": "on target"
};
const actionClass = a => (a === "buy" || a === "sell" || a === "partial" ? a : "hold");

function paint() {
  const d = div();
  const C = num(state.C);
  const weights = state.rows.map(r => ({ w: num(r.w) / d, t: hasTarget(r) ? num(r.t) / d : null }));
  const wSum = weights.reduce((a, r) => a + r.w, 0);
  // IBKR weights include uninvested cash, so they sum to <100%; treat the gap as
  // deployable cash and switch to the buy-only cash model.
  const cashMode = wSum > 0 && wSum < 1 - Rebalance.TOL;

  const res = cashMode
    ? Rebalance.planCash({ C, fee: FEE, rows: weights })
    : Rebalance.plan({ C, noSell: !!state.noSell, capOn: !!state.capOn, cap: num(state.cap), rows: weights });

  const pf = v => (state.unit === "pct" ? fmt(v * 100, 1) + "%" : fmt(v, 3));

  res.rows.forEach(rr => {
    const i = rr.i, xe = $("x" + i); if (!xe) return;
    const cls = actionClass(rr.action);
    const ccy = rowCcy(state.rows[i]);
    let txt;
    if (rr.action === "buy") txt = "buy +" + money(rr.x, ccy);
    else if (rr.action === "sell") txt = "sell −" + money(rr.x, ccy);
    else if (rr.action === "partial") txt = (rr.x >= 0 ? "part. buy +" : "part. sell −") + money(rr.x, ccy);
    else txt = ACTION_LABEL[rr.action] || "hold";
    if (rr.fee) txt += " · fee " + fmt(rr.fee) + " " + state.base;

    xe.textContent = txt; xe.className = "x " + cls;
    $("f" + i).textContent = isFinite(rr.final) ? pf(rr.final) : "—";
    const ge = $("g" + i), bf = $("bf" + i), bt = $("bt" + i);
    ge.textContent = "now " + pf(rr.w) + (rr.hasT ? " · tgt " + pf(rr.t) : "");
    bf.className = "fill " + cls;
    bf.style.width = Math.max(0, Math.min(100, (isFinite(rr.final) ? rr.final : 0) * 100)) + "%";
    if (rr.hasT) { bt.style.display = "block"; bt.style.left = Math.max(0, Math.min(100, rr.t * 100)) + "%"; }
    else bt.style.display = "none";
  });

  $("S").textContent = isFinite(res.S) ? fmt(res.S) + " " + state.base : "—";

  if (cashMode) {
    $("total").textContent = isFinite(res.deployed) ? "+" + fmt(res.deployed) + " " + state.base : "—";
    $("sums").innerHTML =
      `<span>Σw ${fmt(res.wSum * 100, 1)}% · cash ${fmt((1 - res.wSum) * 100, 1)}%</span>` +
      `<span>deploy ${fmt(res.deployed)} · fees ${fmt(res.fees)}</span>` +
      `<span>cash left ${fmt(res.cashAfter)} ${state.base}</span>`;
  } else {
    $("total").textContent = isFinite(res.S) ? (res.net >= 0 ? "+" : "−") + fmt(Math.abs(res.net)) + " " + state.base : "—";
    $("sums").innerHTML = `<span>Σw now ${fmt(res.wSum * 100, 1)}%</span>` +
      `<span>buys ${fmt(res.buys)} · sells ${fmt(res.sells)}</span>` +
      `<span>Σ final ${fmt(res.finSum * 100, 1)}%</span>`;
  }

  const notes = [];
  if (cashMode) {
    notes.push(`${fmt((1 - res.wSum) * 100, 1)}% uninvested cash (${fmt(res.cash)} ${state.base}) deployed buy-only`);
    notes.push(`${fmt(FEE)} ${state.base} reserved per trade`);
    if (res.mode === "cash-short") notes.push(`cash short of all targets — most-underweight funded first`);
  } else {
    if (res.mode === "capped") notes.push(`Cap: net ${fmt(res.net)} = cap · ${res.capHeld} held${res.partialCount ? " + 1 partial" : ""}`);
    if (state.noSell && res.noSellHeldCount > 0) notes.push(`${res.noSellHeldCount} above-target asset(s) held (no selling)`);
  }
  const nb = $("note");
  if (notes.length) { nb.style.display = "block"; nb.textContent = notes.join(" · "); } else nb.style.display = "none";

  const wb = $("warn");
  const msgs = (res.warnings || []).map(w => {
    if (w.code === "weights-sum") return `Initial weights sum to ${fmt(w.value * 100, 2)}% — must be 100% (±0.5pp). Fix inputs; results below are unreliable.`;
    if (w.code === "targets-over") return `Targets sum to ${fmt(w.value * 100, 1)}% (>100%). Lower a target.`;
    return "";
  }).filter(Boolean);
  if (msgs.length) { wb.style.display = "block"; wb.innerHTML = msgs.map(m => "⚠ " + m).join("<br>"); }
  else wb.style.display = "none";
}

document.addEventListener("input", e => {
  const t = e.target;
  if (t.id === "C") state.C = t.value;
  else if (t.id === "cap") state.cap = t.value;
  else if (t.dataset.i != null) {
    const k = t.dataset.k, was = hasTarget(state.rows[+t.dataset.i]);
    state.rows[+t.dataset.i][k] = t.value;
    if (k === "t" && was !== hasTarget(state.rows[+t.dataset.i])) { save(); render(); return; }
  } else return;
  save(); paint();
});
document.addEventListener("change", e => {
  if (e.target.id === "unit") { state.unit = e.target.value; save(); render(); }
  else if (e.target.id === "base") { state.base = e.target.value; save(); render(); fetchRates(); }
  else if (e.target.id === "capOn") { state.capOn = e.target.checked; save(); render(); }
  else if (e.target.id === "noSell") { state.noSell = e.target.checked; save(); paint(); }
  else if (e.target.dataset.i != null && e.target.dataset.k === "ccy") {
    state.rows[+e.target.dataset.i].ccy = e.target.value; save(); paint();
  }
});
$("fxref").onclick = () => fetchRates();
$("add").onclick = () => { state.rows.push(blank("Asset " + (state.rows.length + 1))); save(); render(); };
document.addEventListener("click", e => {
  if (e.target.dataset.del != null) { state.rows.splice(+e.target.dataset.del, 1); save(); render(); }
});

render();
fetchRates();
