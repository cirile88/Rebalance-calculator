# Rebalance Calculator

A single-file, mobile-friendly web tool that tells you exactly how much of each
asset to buy (or sell) to move a portfolio from its current weights to target
weights. Runs entirely in the browser, saves your inputs on the device, and
needs no backend.

**Live:** https://rebalance-calc-emiliano.netlify.app

## What it does

You enter the portfolio value, then for each asset its current weight `w` and a
target weight `t`. The tool returns, per asset:

- the trade `x` (buy / sell amount),
- the resulting weight after the trade, shown as a bar with a target tick so you
  can see where you land,

plus the total cash to deploy and the portfolio value afterwards.

## Inputs

- **C** — current invested amount (portfolio total).
- **Weights as** — enter `w`/`t` as percent or as fractions (0–1).
- **Now w / Target t** per asset. Leave a target **blank to hold** the asset
  (it is never traded; its weight simply drifts as the rest changes).

## Options

- **Avoid selling (buy-only).** Any asset already above its target can't be sold,
  so it is held and its weight is diluted down as you buy the others; only the
  underweight assets are bought.
- **Limit net new cash (cap).** Caps `S − C`. If the targets need more cash than
  the cap, assets nearest their target (by relative gap `|t − w| / t`) are dropped
  to "hold" one by one until the spend fits; the last dropped asset is then
  partially funded so the spend equals the cap exactly.

## The model

For the rebalanced assets, with held/unlisted assets forming the rest:

```
S  = C · (1 − Σw) / (1 − Σt)      (total after rebalancing)
xᵢ = tᵢ · S − wᵢ · C             (trade for asset i; negative = sell)
net new cash = S − C
```

When the targets fully specify the portfolio (`Σt ≈ 100%`, no held bucket) the
identity is degenerate and net cash becomes a free choice:

- selling allowed, no cap → `S = C` (net-zero reshuffle),
- buy-only → `S = C · max(wᵢ / tᵢ)` (minimum cash so nothing must be sold),
- cap on → `S = C + cap`.

## Checks

- Initial weights must sum to **100% (±0.5pp)**; otherwise the result is flagged
  as unreliable.
- Warns if rebalanced targets sum to more than 100%.
- The "Σ final" line confirms post-trade weights total 100%.

## Files

- `index.html` — markup and styling only.
- `rebalance.js` — the pure math (`calcS`, `solveS`, `plan`). No DOM; runs in the
  browser and in Node, so the page and the tests share identical logic.
- `app.js` — DOM wiring: reads inputs, calls `Rebalance.plan`, renders results.
- `test.js` — Node tests over `rebalance.js`.

No build step — the browser loads the two scripts directly.

## Develop, test & deploy

```bash
git clone https://github.com/cirile88/Rebalance-calculator.git
cd Rebalance-calculator
node test.js          # run the test suite
# edit files, then:
git add -A && git commit -m "update" && git push
```

Netlify is linked to this repo, so every push to `main` redeploys automatically.

## Use on a phone

Open the live link in Safari → **Share → Add to Home Screen** for an app icon
with persistent inputs.
