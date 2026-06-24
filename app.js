// DOM wiring: state, persistence, rendering. All math lives in rebalance.js.
const $ = id => document.getElementById(id);
const KEY = "rebalc_v3";
const fmt = (n, d = 2) => (isFinite(n) ? n : 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

const blank = (name = "") => ({ name, w: "", t: "" });
let state = load() || { C: "", unit: "pct", noSell: true, capOn: false, cap: "", rows: [blank("Asset 1"), blank("Asset 2")] };
if (state.noSell === undefined) state.noSell = true;

function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
const esc = s => String(s).replace(/"/g, "&quot;");
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const hasTarget = r => String(r.t).trim() !== "";
const div = () => (state.unit === "pct" ? 100 : 1);

function render() {
  $("C").value = state.C; $("unit").value = state.unit;
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

const ACTION_LABEL = {
  "hold-blank": "hold",
  "hold-nosell": "held — no sell",
  "hold-cap": "held — cap"
};
const actionClass = a => (a === "buy" || a === "sell" || a === "partial" ? a : "hold");

function paint() {
  const d = div();
  const res = Rebalance.plan({
    C: num(state.C),
    noSell: !!state.noSell,
    capOn: !!state.capOn,
    cap: num(state.cap),
    rows: state.rows.map(r => ({ w: num(r.w) / d, t: hasTarget(r) ? num(r.t) / d : null }))
  });

  const pf = v => (state.unit === "pct" ? fmt(v * 100, 1) + "%" : fmt(v, 3));

  res.rows.forEach(rr => {
    const i = rr.i, xe = $("x" + i); if (!xe) return;
    const cls = actionClass(rr.action);
    let txt;
    if (rr.action === "buy") txt = "buy +" + fmt(Math.abs(rr.x));
    else if (rr.action === "sell") txt = "sell −" + fmt(Math.abs(rr.x));
    else if (rr.action === "partial") txt = (rr.x >= 0 ? "part. buy +" : "part. sell −") + fmt(Math.abs(rr.x));
    else txt = ACTION_LABEL[rr.action];

    xe.textContent = txt; xe.className = "x " + cls;
    $("f" + i).textContent = isFinite(rr.final) ? pf(rr.final) : "—";
    const ge = $("g" + i), bf = $("bf" + i), bt = $("bt" + i);
    ge.textContent = "now " + pf(rr.w) + (rr.hasT ? " · tgt " + pf(rr.t) : "");
    bf.className = "fill " + cls;
    bf.style.width = Math.max(0, Math.min(100, (isFinite(rr.final) ? rr.final : 0) * 100)) + "%";
    if (rr.hasT) { bt.style.display = "block"; bt.style.left = Math.max(0, Math.min(100, rr.t * 100)) + "%"; }
    else bt.style.display = "none";
  });

  $("S").textContent = isFinite(res.S) ? fmt(res.S) : "—";
  $("total").textContent = isFinite(res.S) ? (res.net >= 0 ? "+" : "−") + fmt(Math.abs(res.net)) : "—";
  $("sums").innerHTML = `<span>Σw now ${fmt(res.wSum * 100, 1)}%</span>` +
    `<span>buys ${fmt(res.buys)} · sells ${fmt(res.sells)}</span>` +
    `<span>Σ final ${fmt(res.finSum * 100, 1)}%</span>`;

  const notes = [];
  if (res.mode === "capped") notes.push(`Cap: net ${fmt(res.net)} = cap · ${res.capHeld} held${res.partialCount ? " + 1 partial" : ""}`);
  if (state.noSell && res.noSellHeldCount > 0) notes.push(`${res.noSellHeldCount} above-target asset(s) held (no selling)`);
  const nb = $("note");
  if (notes.length) { nb.style.display = "block"; nb.textContent = notes.join(" · "); } else nb.style.display = "none";

  const wb = $("warn");
  if (res.warnings.length) {
    const msgs = res.warnings.map(w => {
      if (w.code === "weights-sum") return `Initial weights sum to ${fmt(w.value * 100, 2)}% — must be 100% (±0.5pp). Fix inputs; results below are unreliable.`;
      if (w.code === "targets-over") return `Rebalanced targets sum to ${fmt(w.value * 100, 1)}% (>100%). Lower a target or add a hold item.`;
      return "";
    });
    wb.style.display = "block"; wb.innerHTML = msgs.map(m => "⚠ " + m).join("<br>");
  } else wb.style.display = "none";
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
  else if (e.target.id === "capOn") { state.capOn = e.target.checked; save(); render(); }
  else if (e.target.id === "noSell") { state.noSell = e.target.checked; save(); paint(); }
});
$("add").onclick = () => { state.rows.push(blank("Asset " + (state.rows.length + 1))); save(); render(); };
document.addEventListener("click", e => {
  if (e.target.dataset.del != null) { state.rows.splice(+e.target.dataset.del, 1); save(); render(); }
});

render();
