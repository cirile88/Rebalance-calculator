// DOM wiring: state, persistence, rendering. All math lives in rebalance.js.
const $ = id => document.getElementById(id);
const KEY = "rebalc_v4";
const fmt = (n, d = 2) => (isFinite(n) ? n : 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

// Currencies offered (frankfurter.app supported set; base + per-asset picker).
const CCYS = ["CHF", "EUR", "USD", "GBP", "JPY", "AUD", "CAD", "CNY", "SEK", "NOK",
  "DKK", "SGD", "HKD", "NZD", "PLN", "CZK", "HUF", "INR", "KRW", "MXN",
  "BRL", "ZAR", "TRY", "ILS", "RON", "IDR", "ISK", "MYR", "PHP", "THB"];
// Hit the .dev host directly: the .app host 301-redirects here and the redirect
// response drops CORS headers, which fails the cross-origin fetch in browsers.
const FX_URL = base => "https://api.frankfurter.dev/v1/latest?base=" + encodeURIComponent(base);

const blank = (name = "") => ({ name, amt: "", ccy: state ? state.base : "CHF", t: "" });
let state = load() || {
  base: "CHF", unit: "pct", noSell: true, capOn: false, cap: "",
  rows: [{ name: "Asset 1", amt: "", ccy: "CHF", t: "" },
         { name: "Asset 2", amt: "", ccy: "CHF", t: "" }],
  fx: null
};
if (state.noSell === undefined) state.noSell = true;

function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
const esc = s => String(s).replace(/"/g, "&quot;");
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const hasTarget = r => String(r.t).trim() !== "";
const div = () => (state.unit === "pct" ? 100 : 1);
const ccyOpts = sel => CCYS.map(c => `<option value="${c}"${c === sel ? " selected" : ""}>${c}</option>`).join("");
const rates = () => (state.fx && state.fx.base === state.base ? state.fx.rates : {});

function render() {
  $("base").innerHTML = ccyOpts(state.base);
  $("base").value = state.base;
  $("unit").value = state.unit;
  $("noSell").checked = !!state.noSell;
  $("capOn").checked = !!state.capOn; $("cap").value = state.cap; $("cap").disabled = !state.capOn;
  const box = $("rows"); box.innerHTML = "";
  state.rows.forEach((r, i) => {
    const el = document.createElement("div");
    el.className = "asset" + (hasTarget(r) ? "" : " hold");
    el.innerHTML = `
      <div class="arow">
        <input class="name" data-i="${i}" data-k="name" placeholder="Name" value="${esc(r.name)}">
        <button class="del" data-del="${i}" aria-label="Remove">×</button>
      </div>
      <div class="fields">
        <div class="fld" style="flex:1.5"><label>Value</label>
          <input class="num" data-i="${i}" data-k="amt" inputmode="decimal" placeholder="0" value="${esc(r.amt)}"></div>
        <div class="fld"><label>Cur</label>
          <select data-i="${i}" data-k="ccy">${ccyOpts(r.ccy || state.base)}</select></div>
        <div class="fld"><label>Target ${state.unit === "pct" ? "%" : "0–1"}</label>
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

const ACTION_LABEL = {
  "hold-blank": "hold",
  "hold-nosell": "held — no sell",
  "hold-cap": "held — cap"
};
const actionClass = a => (a === "buy" || a === "sell" || a === "partial" ? a : "hold");

function paint() {
  const d = div();
  const conv = Rebalance.weightsFromAmounts(
    state.rows.map(r => ({ amt: num(r.amt), ccy: r.ccy || state.base })),
    rates(), state.base);
  const C = conv.C;
  const money = v => fmt(v) + " " + state.base;

  const res = Rebalance.plan({
    C,
    noSell: !!state.noSell,
    capOn: !!state.capOn,
    cap: num(state.cap),
    rows: state.rows.map((r, i) => ({ w: conv.weights[i], t: hasTarget(r) ? num(r.t) / d : null }))
  });

  const pf = v => (state.unit === "pct" ? fmt(v * 100, 1) + "%" : fmt(v, 3));

  res.rows.forEach(rr => {
    const i = rr.i, xe = $("x" + i); if (!xe) return;
    const cls = actionClass(rr.action);
    let txt;
    if (rr.action === "buy") txt = "buy +" + money(Math.abs(rr.x));
    else if (rr.action === "sell") txt = "sell −" + money(Math.abs(rr.x));
    else if (rr.action === "partial") txt = (rr.x >= 0 ? "part. buy +" : "part. sell −") + money(Math.abs(rr.x));
    else txt = ACTION_LABEL[rr.action];

    xe.textContent = txt; xe.className = "x " + cls;
    $("f" + i).textContent = isFinite(rr.final) ? pf(rr.final) : "—";
    const ge = $("g" + i), bf = $("bf" + i), bt = $("bt" + i);
    const valBase = isFinite(rr.w) ? rr.w * C : 0;
    ge.textContent = "now " + pf(rr.w) + " · " + money(valBase) + (rr.hasT ? " · tgt " + pf(rr.t) : "");
    bf.className = "fill " + cls;
    bf.style.width = Math.max(0, Math.min(100, (isFinite(rr.final) ? rr.final : 0) * 100)) + "%";
    if (rr.hasT) { bt.style.display = "block"; bt.style.left = Math.max(0, Math.min(100, rr.t * 100)) + "%"; }
    else bt.style.display = "none";
  });

  $("C").textContent = C > 0 ? money(C) : "—";
  $("S").textContent = isFinite(res.S) ? money(res.S) : "—";
  $("total").textContent = isFinite(res.S) ? (res.net >= 0 ? "+" : "−") + money(Math.abs(res.net)) : "—";
  $("sums").innerHTML = `<span>Σw now ${fmt(res.wSum * 100, 1)}%</span>` +
    `<span>buys ${money(res.buys)} · sells ${money(res.sells)}</span>` +
    `<span>Σ final ${fmt(res.finSum * 100, 1)}%</span>`;

  // FX status line
  const fxn = $("fxnote");
  if (state.fx && state.fx.base === state.base) fxn.textContent = "Rates: 1 " + state.base + " — " + state.fx.date + " (frankfurter.app)";
  else fxn.textContent = "Loading rates…";

  const notes = [];
  if (res.mode === "capped") notes.push(`Cap: net ${money(res.net)} = cap · ${res.capHeld} held${res.partialCount ? " + 1 partial" : ""}`);
  if (state.noSell && res.noSellHeldCount > 0) notes.push(`${res.noSellHeldCount} above-target asset(s) held (no selling)`);
  const nb = $("note");
  if (notes.length) { nb.style.display = "block"; nb.textContent = notes.join(" · "); } else nb.style.display = "none";

  const wb = $("warn");
  const msgs = [];
  if (conv.missing.length) msgs.push(`No exchange rate for ${conv.missing.join(", ")} — those holdings are excluded. Check your connection or base currency.`);
  res.warnings.forEach(w => {
    if (w.code === "targets-over") msgs.push(`Rebalanced targets sum to ${fmt(w.value * 100, 1)}% (>100%). Lower a target or add a hold item.`);
    // "weights-sum" can't trigger now: weights are derived and always sum to 100%.
  });
  if (msgs.length) { wb.style.display = "block"; wb.innerHTML = msgs.map(m => "⚠ " + m).join("<br>"); }
  else wb.style.display = "none";
}

async function fetchRates(base) {
  $("fxnote").textContent = "Loading rates…";
  try {
    const r = await fetch(FX_URL(base));
    if (!r.ok) throw new Error("http " + r.status);
    const j = await r.json();
    const rates = j.rates || {}; rates[base] = 1;
    state.fx = { base, date: j.date, rates };
    save(); paint();
  } catch (e) {
    if (state.fx && state.fx.base === base)
      $("fxnote").textContent = "Offline — using cached rates from " + state.fx.date;
    else
      $("fxnote").textContent = "⚠ Couldn't load exchange rates. Check your connection.";
  }
}

document.addEventListener("input", e => {
  const t = e.target;
  if (t.id === "cap") state.cap = t.value;
  else if (t.dataset.i != null) {
    const k = t.dataset.k, was = hasTarget(state.rows[+t.dataset.i]);
    state.rows[+t.dataset.i][k] = t.value;
    if (k === "t" && was !== hasTarget(state.rows[+t.dataset.i])) { save(); render(); return; }
  } else return;
  save(); paint();
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "base") { state.base = t.value; save(); paint(); fetchRates(state.base); }
  else if (t.id === "unit") { state.unit = t.value; save(); render(); }
  else if (t.id === "capOn") { state.capOn = t.checked; save(); render(); }
  else if (t.id === "noSell") { state.noSell = t.checked; save(); paint(); }
});
const fxref = $("fxref"); if (fxref) fxref.onclick = () => fetchRates(state.base);
$("add").onclick = () => { state.rows.push(blank("Asset " + (state.rows.length + 1))); save(); render(); };
document.addEventListener("click", e => {
  if (e.target.dataset.del != null) { state.rows.splice(+e.target.dataset.del, 1); save(); render(); }
});

render();
fetchRates(state.base);
