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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
