// DOM wiring: state, persistence, rendering. All math lives in rebalance.js.
const $ = id => document.getElementById(id);
const KEY = "rebalc_v7";
const BP = 10000; // basis points per 1.0 (100% = 10000 bp)
const fmt = (n, d = 2) => (isFinite(n) ? n : 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

const blank = (name = "") => ({ name, w: "", t: "", ccy: "" });
let state = load() || { S: "", cash: "", noSell: true, base: "CHF", rows: [blank("Asset 1"), blank("Asset 2")] };
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
// Format a trade in the asset's own currency (the order size you place),
// with the base-currency equivalent shown in parentheses for reference.
function money(amtBase, ccy) {
  const b = fmt(Math.abs(amtBase)) + " " + state.base;
  if (ccy === state.base) return b;
  const c = conv(Math.abs(amtBase), ccy);
  if (c == null) return b + " (no " + ccy + " rate)";
  return fmt(c) + " " + ccy + " (" + b + ")";
}

function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
const esc = s => String(s).replace(/"/g, "&quot;");
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const hasTarget = r => String(r.t).trim() !== "";

function render() {
  $("inTotal").value = state.S; $("inCash").value = state.cash;
  $("base").innerHTML = ccyOptions(state.base);
  $("noSell").checked = !!state.noSell;
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
        <div class="fld"><label>Now w (bp)</label>
          <input class="num" data-i="${i}" data-k="w" inputmode="decimal" placeholder="0" value="${esc(r.w)}"></div>
        <div class="fld"><label>Target t (bp)</label>
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
  "hold-cash": "held — no cash",
  "hold-over": "held — above tgt",
  "hold-on-target": "on target"
};
const actionClass = a => (a === "buy" || a === "sell" || a === "partial" ? a : "hold");

function paint() {
  const S = num(state.S), cash = num(state.cash);
  const res = Rebalance.planGreedy({
    S, cash, fee: FEE, noSell: !!state.noSell,
    rows: state.rows.map(r => ({ w: num(r.w) / BP, t: hasTarget(r) ? num(r.t) / BP : null }))
  });

  const pf = v => fmt(v * BP, 0) + " bp";

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

  const deployed = res.cash - res.leftover; // cash that actually left S−C (= net + fees)
  const signed = v => (v >= 0 ? "+" : "−") + fmt(Math.abs(v)) + " " + state.base;
  $("deployed").textContent = isFinite(deployed) ? signed(deployed) : "—";
  $("net").textContent = isFinite(res.net) ? signed(res.net) : "—";
  $("S").textContent = isFinite(res.S) ? fmt(res.S) + " " + state.base : "—";
  $("sums").innerHTML =
    `<span>invested C ${fmt(res.C)} ${state.base}</span>` +
    `<span>buys ${fmt(res.buys)} · sells ${fmt(res.sells)}</span>` +
    `<span>S−C = net ${fmt(res.net)} + fees ${fmt(res.fees)} + leftover ${fmt(res.leftover)} ${state.base}</span>`;

  const notes = [];
  if (res.rationed)
    notes.push(`cash short: filled biggest xᵢ first, ${fmt(res.desiredBuys - res.buys)} ${state.base} of buys unfunded`);
  if (state.noSell && res.rows.some(r => r.action === "hold-over"))
    notes.push("buy-only: overweight assets held (not sold)");
  notes.push(`${fmt(FEE)} ${state.base} per trade`);
  const nb = $("note");
  if (notes.length) { nb.style.display = "block"; nb.textContent = notes.join(" · "); } else nb.style.display = "none";

  const wb = $("warn");
  const msgs = [];
  (res.warnings || []).forEach(w => {
    if (w.code === "cash-over-total") msgs.push(`Cash to invest exceeds the total S.`);
  });
  if (msgs.length) { wb.style.display = "block"; wb.innerHTML = msgs.map(m => "⚠ " + m).join("<br>"); }
  else wb.style.display = "none";
}

document.addEventListener("input", e => {
  const t = e.target;
  if (t.id === "inTotal") state.S = t.value;
  else if (t.id === "inCash") state.cash = t.value;
  else if (t.dataset.i != null) {
    const k = t.dataset.k, was = hasTarget(state.rows[+t.dataset.i]);
    state.rows[+t.dataset.i][k] = t.value;
    if (k === "t" && was !== hasTarget(state.rows[+t.dataset.i])) { save(); render(); return; }
  } else return;
  save(); paint();
});
document.addEventListener("change", e => {
  if (e.target.id === "base") { state.base = e.target.value; save(); render(); fetchRates(); }
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
