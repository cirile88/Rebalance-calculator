// Pure rebalancing math — no DOM, no globals beyond the exported API.
// Works in the browser (window.Rebalance) and in Node (module.exports),
// so app.js and test.js share exactly the same logic.
(function (global) {
  "use strict";

  const EPS = 1e-9;
  const TOL = 0.005; // 0.5pp tolerance on the initial-weights sum

  const relgap = r => (r.t === 0 ? Infinity : Math.abs(r.t - r.w) / Math.abs(r.t));

  // Total value S that puts every rebalanced asset on target while the rest floats.
  function calcS(set, C) {
    let sw = 0, st = 0;
    set.forEach(r => { sw += r.w; st += r.t; });
    const S = set.length ? C * (1 - sw) / (1 - st) : C;
    return { S, sw, st, N: S - C };
  }

  // Robust S: when the targets fully specify the portfolio (Σt ≈ 100%) the float
  // identity is degenerate (0/0) and net cash becomes a free choice.
  function solveS(set, C, ctx) {
    let sw = 0, st = 0;
    set.forEach(r => { sw += r.w; st += r.t; });
    if (!set.length) return C;
    if (Math.abs(1 - st) > EPS) return C * (1 - sw) / (1 - st); // floating rest bucket
    if (ctx.capOn) return C + ctx.cap;                          // deploy exactly the cap
    if (ctx.noSell) {                                           // min buy-only cash
      let mx = 0; set.forEach(r => { if (r.t > EPS) mx = Math.max(mx, r.w / r.t); });
      return C * mx;
    }
    return C;                                                   // selling on → net-zero reshuffle
  }

  // input:  { C, noSell, capOn, cap, rows: [{ w, t }] }  (w,t as fractions; t null/"" = hold)
  // output: { S, net, buys, sells, finSum, wSum, mode, capHeld, partialCount,
  //           noSellHeldCount, rows: [{ i, action, x, final, w, t, hasT }], warnings: [{code,value}] }
  // action ∈ buy | sell | partial | hold-blank | hold-nosell | hold-cap
  function plan(input) {
    const C = input.C, noSell = !!input.noSell, capOn = !!input.capOn, cap = input.cap || 0;
    const norm = input.rows.map((r, idx) => {
      const hasT = r.t != null && r.t !== "";
      return { i: idx, w: r.w || 0, hasT, t: hasT ? r.t : 0 };
    });
    const reb = norm.filter(r => r.hasT);
    const wSumAll = norm.reduce((a, r) => a + r.w, 0);
    const ctx = { noSell, capOn, cap };

    // Phase 1 — no-sell: hold any asset that would need selling, recompute, repeat.
    let working = reb.slice();
    const noSellHeld = new Set();
    if (noSell) {
      let guard = 0;
      while (guard++ <= reb.length) {
        const S = solveS(working, C, ctx);
        let worst = null, wx = -EPS;
        for (const r of working) { const x = r.t * S - r.w * C; if (x < wx) { wx = x; worst = r; } }
        if (!worst) break;
        working = working.filter(z => z.i !== worst.i); noSellHeld.add(worst.i);
      }
    }

    // Phase 2 — cap on net new cash.
    let bt = 0; working.forEach(r => { bt += r.t; });
    let Sfinal = solveS(working, C, ctx); const baseN = Sfinal - C;
    let activeIds = new Set(working.map(r => r.i)), boundaryId = null, partialT = null, mode = "exact", capHeld = 0;
    const warnings = [];
    if (wSumAll > 0 && Math.abs(wSumAll - 1) > TOL) warnings.push({ code: "weights-sum", value: wSumAll });
    if (bt > 1 + EPS) warnings.push({ code: "targets-over", value: bt });

    if (capOn && isFinite(baseN) && bt < 1 - EPS && baseN > cap) {
      mode = "capped";
      const order = working.slice().sort((a, b) => relgap(a) - relgap(b));
      let active = working.slice(), removed = [];
      while (removed.length < order.length && calcS(active, C).N > cap) {
        const drop = order[removed.length];
        active = active.filter(r => r.i !== drop.i);
        removed.push(drop);
      }
      activeIds = new Set(active.map(r => r.i));
      const boundary = removed.length ? removed[removed.length - 1] : null;
      capHeld = Math.max(0, removed.length - (boundary ? 1 : 0));
      if (boundary) {
        boundaryId = boundary.i;
        let sw2 = 0, st2 = 0; active.forEach(r => { sw2 += r.w; st2 += r.t; });
        Sfinal = C + cap;
        let tp = 1 - st2 - C * (1 - sw2 - boundary.w) / (C + cap);
        const fl = boundary.w * C / Sfinal, lo = Math.min(fl, boundary.t), hi = Math.max(fl, boundary.t);
        partialT = Math.max(lo, Math.min(hi, tp));
      } else { Sfinal = calcS(active, C).S; }
    }

    let finSum = 0, wSum = 0, buys = 0, sells = 0;
    const rows = norm.map(r => {
      let x = 0, final, action;
      const floatFin = r.w * C / Sfinal;
      if (!r.hasT) { final = floatFin; action = "hold-blank"; }
      else if (noSellHeld.has(r.i)) { final = floatFin; action = "hold-nosell"; }
      else if (activeIds.has(r.i)) {
        x = r.t * Sfinal - r.w * C;
        if (noSell && x < -EPS) { x = 0; final = floatFin; action = "hold-nosell"; }
        else { final = r.t; action = x >= 0 ? "buy" : "sell"; }
      }
      else if (r.i === boundaryId) {
        x = partialT * Sfinal - r.w * C;
        if (noSell && x < -EPS) { x = 0; final = floatFin; action = "hold-nosell"; }
        else { final = partialT; action = "partial"; }
      }
      else { final = floatFin; action = "hold-cap"; }
      if (x > 0) buys += x; else sells += -x;
      finSum += isFinite(final) ? final : 0; wSum += r.w;
      return { i: r.i, action, x, final, w: r.w, t: r.t, hasT: r.hasT };
    });

    return {
      S: Sfinal, net: Sfinal - C, buys, sells, finSum, wSum,
      mode, capHeld, partialCount: boundaryId != null ? 1 : 0, noSellHeldCount: noSellHeld.size,
      rows, warnings
    };
  }

  const API = { EPS, TOL, relgap, calcS, solveS, plan };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else global.Rebalance = API;
})(typeof self !== "undefined" ? self : this);
