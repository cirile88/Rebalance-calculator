// Run: node test.js
// Verifies the pure rebalancing engine in rebalance.js against known scenarios.
const R = require("./rebalance.js");

let pass = 0, fail = 0;
const approx = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

function check(name, cond) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

// rows use percent inputs; convert to fractions for the engine.
const P = arr => arr.map(([w, t]) => ({ w: w / 100, t: t == null ? null : t / 100 }));

function plan(C, rows, noSell, capOn, cap) {
  return R.plan({ C, noSell, capOn, cap: cap || 0, rows: P(rows) });
}

console.log("1) Full-spec 100% targets, selling allowed → net-zero reshuffle");
{
  const r = plan(10000, [[10, 20], [30, 25], [15, 15], [10, 10], [20, 15], [15, 15]], false, false, 0);
  check("net cash ≈ 0", approx(r.net, 0));
  check("Σ final ≈ 100%", approx(r.finSum, 1, 1e-4));
  check("no over-100 warning", r.warnings.every(w => w.code !== "targets-over"));
  check("asset0 buys to 20%", r.rows[0].action === "buy" && approx(r.rows[0].final, 0.2));
  check("asset1 sells", r.rows[1].action === "sell");
}

console.log("2) Same, buy-only → minimum cash, nobody sells");
{
  const r = plan(10000, [[10, 20], [30, 25], [15, 15], [10, 10], [20, 15], [15, 15]], true, false, 0);
  check("net cash ≈ 3333", approx(r.net, 3333.33, 1));
  check("no sells", r.sells === 0);
  check("binding asset (20→15) held at target", approx(r.rows[4].final, 0.15));
  check("Σ final ≈ 100%", approx(r.finSum, 1, 1e-4));
}

console.log("3) Cap + partial fund (has held rest bucket)");
{
  const r = plan(100, [[10, 40], [38, 40], [52, null]], true, true, 80);
  check("mode capped", r.mode === "capped");
  check("net cash = cap (80)", approx(r.net, 80));
  check("asset0 full buy to 40%", r.rows[0].action === "buy" && approx(r.rows[0].final, 0.4));
  check("asset1 partial", r.rows[1].action === "partial" && approx(r.rows[1].final, 0.3111, 0.002));
  check("asset2 holds", r.rows[2].action === "hold-blank");
  check("Σ final ≈ 100%", approx(r.finSum, 1, 1e-4));
}

console.log("4) No-sell holds an overexposed asset");
{
  const r = plan(100, [[70, 30], [10, 40], [20, null]], true, false, 0);
  check("overexposed asset0 held (no sell)", r.rows[0].action === "hold-nosell");
  check("asset1 buys to 40%", r.rows[1].action === "buy" && approx(r.rows[1].final, 0.4));
  check("net cash ≈ 50", approx(r.net, 50));
  check("noSellHeldCount = 1", r.noSellHeldCount === 1);
}

console.log("5) Initial weights ≠ 100% → warning");
{
  const r = plan(1000, [[10, 20], [30, 30]], false, false, 0); // Σw = 40%
  check("weights-sum warning present", r.warnings.some(w => w.code === "weights-sum"));
}

console.log("6) Targets > 100% → over-100 warning");
{
  const r = plan(1000, [[50, 60], [50, 60]], false, false, 0);
  check("targets-over warning present", r.warnings.some(w => w.code === "targets-over"));
}

console.log("7) Cash deploy (fee 0): weights sum <100%, gap funds buys to target");
{
  // A 40→60, B 30→40, 30% cash; no fee → cash (3000) exactly hits both targets.
  const r = R.planCash({ C: 10000, fee: 0, rows: P([[40, 60], [30, 40]]) });
  check("A full buy 2000", r.rows[0].action === "buy" && approx(r.rows[0].x, 2000));
  check("B full buy 1000", r.rows[1].action === "buy" && approx(r.rows[1].x, 1000));
  check("deployed = cash (3000)", approx(r.deployed, 3000));
  check("no external cash, S = C", approx(r.S, 10000));
  check("cash fully used", approx(r.cashAfter, 0));
  check("mode cash (not short)", r.mode === "cash");
}

console.log("8) Cash deploy with 2/trade fee: fee reserved, last trade partial");
{
  const r = R.planCash({ C: 10000, fee: 2, rows: P([[40, 60], [30, 40]]) });
  check("A full buy 2000", approx(r.rows[0].x, 2000) && r.rows[0].fee === 2);
  check("B partial 996 (fees ate 4)", r.rows[1].action === "partial" && approx(r.rows[1].x, 996));
  check("total fees = 4", approx(r.fees, 4));
  check("S = C − fees", approx(r.S, 9996));
  check("flagged cash-short", r.mode === "cash-short");
}

console.log("9) Overweight asset is held (buy-only, no selling)");
{
  // A 70→60 (over), B 10→40 (under), 20% cash.
  const r = R.planCash({ C: 10000, fee: 2, rows: P([[70, 60], [10, 40]]) });
  check("A held (overweight)", r.rows[0].action === "hold-over" && r.rows[0].x === 0);
  check("B partially funded by 2000 cash", r.rows[1].action === "partial" && approx(r.rows[1].x, 1998));
  check("only one fee charged", approx(r.fees, 2));
}

console.log("10) Blank target holds; cash buffer kept when targets < 100%");
{
  // A 50 hold, B 30→40, 20% cash; B needs 1000, cash 2000 → 1000 left as buffer.
  const r = R.planCash({ C: 10000, fee: 0, rows: P([[50, null], [30, 40]]) });
  check("A hold-blank", r.rows[0].action === "hold-blank" && r.rows[0].x === 0);
  check("B buys to target", r.rows[1].action === "buy" && approx(r.rows[1].x, 1000));
  check("leftover cash buffer ≈ 1000", approx(r.cashAfter, 1000));
}

console.log("11) Invest: moves are (t−w)·T; deploy exactly S");
{
  // T=100, S=20. A 20→30 (+10), B 30→40 (+10) → deploys 20 = S.
  const r = R.planInvest({ T: 100, S: 20, fee: 0, noSell: false, rows: P([[20, 30], [30, 40]]) });
  check("A buy 10", r.rows[0].action === "buy" && approx(r.rows[0].x, 10));
  check("B buy 10", r.rows[1].action === "buy" && approx(r.rows[1].x, 10));
  check("net deployed = S (20)", approx(r.net, 20));
  check("not over budget", r.mode === "ok");
  check("cash left ≈ 0", approx(r.cashAfter, 0));
  check("A final = 30%", approx(r.rows[0].final, 0.30));
}

console.log("12) Invest: a subset is rebalanced, the rest is held (not cash)");
{
  // Only A listed (20→35). The unlisted rest of the account is untouched.
  const r = R.planInvest({ T: 100, S: 20, fee: 0, noSell: false, rows: P([[20, 35]]) });
  check("only one row computed", r.rows.length === 1);
  check("A buy 15", r.rows[0].action === "buy" && approx(r.rows[0].x, 15));
  check("net = 15 (≤ S)", approx(r.net, 15));
  check("cash left = 5", approx(r.cashAfter, 5));
}

console.log("13) Invest: S is a hard budget — buys scale down to fit");
{
  // A 20→50 wants +30 but only 20 available → scaled to 20.
  const r = R.planInvest({ T: 100, S: 20, fee: 0, noSell: true, rows: P([[20, 50]]) });
  check("desired net = 30", approx(r.desiredNet, 30));
  check("flagged over-budget", r.mode === "over-budget");
  check("A partial, scaled to 20", r.rows[0].action === "partial" && approx(r.rows[0].x, 20));
  check("net = S (20)", approx(r.net, 20));
}

console.log("14) Invest: 2/trade fee reserved from the budget");
{
  // A +15, B +10 → wants 25; budget 20−4 fees = 16 → buys scaled to 16.
  const r = R.planInvest({ T: 100, S: 20, fee: 2, noSell: true, rows: P([[20, 35], [30, 40]]) });
  check("fees = 4 (2 trades)", approx(r.fees, 4));
  check("over budget", r.mode === "over-budget");
  check("net scaled to 16", approx(r.net, 16));
  check("cash left ≈ 0", approx(r.cashAfter, 0));
}

console.log("15) Invest buy-only: overweight asset is held, not sold");
{
  // A 20→40 (+20), B 50→30 would sell → held.
  const r = R.planInvest({ T: 100, S: 50, fee: 0, noSell: true, rows: P([[20, 40], [50, 30]]) });
  check("A buys 20", r.rows[0].action === "buy" && approx(r.rows[0].x, 20));
  check("B held (overweight)", r.rows[1].action === "hold-over" && r.rows[1].x === 0);
  check("no sells", approx(r.sells, 0));
}

console.log("16) planFromS: invert formula 1 for C, deploy S−C with no leftover");
{
  // S=100; listed A 10→15, B 20→25 (over C / over S); rest held.
  const r = R.planFromS({ S: 100, fee: 0, noSell: false, rows: P([[10, 15], [20, 25]]) });
  check("C = S(1−Σt)/(1−Σw) ≈ 85.71", approx(r.C, 100 * 0.6 / 0.7, 0.01));
  check("A buy ≈ 6.43", r.rows[0].action === "buy" && approx(r.rows[0].x, 6.4286, 0.01));
  check("B buy ≈ 7.86", approx(r.rows[1].x, 7.8571, 0.01));
  check("Σx = total to invest (S−C)", approx(r.rows[0].x + r.rows[1].x, r.net, 0.001));
  check("listed land on target (15%, 25%)", approx(r.rows[0].final, 0.15) && approx(r.rows[1].final, 0.25));
}

console.log("17) planFromS: held rest dilutes to (1−Σt), is never traded");
{
  const r = R.planFromS({ S: 100, fee: 0, noSell: false, rows: P([[10, 15], [20, 25], [70, null]]) });
  check("held row not traded", r.rows[2].action === "hold-blank" && r.rows[2].x === 0);
  check("held rest final ≈ 60% (1−Σt)", approx(r.rows[2].final, 0.60, 0.005));
}

console.log("18) planFromS: needs a held rest (Σw or Σt = 100% → warning)");
{
  const r = R.planFromS({ S: 100, fee: 0, noSell: false, rows: P([[40, 50], [60, 50]]) });
  check("no-rest warning", r.warnings.some(w => w.code === "no-rest"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
