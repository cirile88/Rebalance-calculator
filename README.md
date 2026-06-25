# Rebalance Calculator

A single-file, mobile-friendly web tool that tells you exactly how much of each
asset to buy (or sell) to move a portfolio from its current weights to target
weights. Runs entirely in the browser, saves your inputs on the device, and
needs no backend.

**Live:** https://rebalance-calc-emiliano.netlify.app

## What it does

You enter the **final account total `S`** (the value after the cash you're adding
is invested) and, for each asset you want to rebalance, its current weight `w`
(as a % of your **currently invested** amount C), target weight `t` (as a % of the
**final total** S), and trading currency. The tool returns, per asset:

- the trade `x = t·S − w·C`, in the base currency, plus its size in the asset's own
  currency (e.g. `buy +1,000 CHF (≈ 1,090 EUR)`),
- the resulting weight after the trade, shown as a bar with a target tick,

plus the total to invest `S − C` and the invested amount `C` it backed out.

Two design points that matter:

- **Only listed assets are traded; the rest is held.** You can rebalance a subset —
  unlisted holdings (and rows with a blank target) are never traded; they simply
  **dilute** to `(1 − Σt)` as the new cash is added. They are never sold and never
  assumed to be cash.
- **The whole `S − C` is deployed onto your targets** — there is no leftover. The
  held rest absorbs the rebalancing by dilution, so the new cash is fully allocated
  to the listed assets in the proportions your targets imply.

## Inputs

- **Total after investing (S)** — the account value once the cash is invested.
- **Weights as** — enter `w`/`t` as percent or as fractions (0–1).
- **Base currency** — the currency totals and trades are expressed in.
- **Now w / Target t / currency** per asset — `w` over the current invested `C`,
  `t` over the final total `S`. Leave a target **blank to hold** (that asset just
  dilutes). The per-asset currency only sets how the order size is displayed.

## Currency conversion

Rates are fetched live from [frankfurter.dev](https://frankfurter.dev) (ECB daily
rates, free, no API key, CORS-enabled) when the page loads, when you change the
base currency, or via the ↻ refresh button. They convert each trade from the base
currency into the asset's own currency for display only — so if rates are
unavailable, totals and trades are still correct, just shown in the base currency.
The `.dev` host is used directly because the older `.app` host 301-redirects and
the redirect drops CORS headers, which fails the fetch in the browser.

## Fees

A flat **2 (base currency) per suggested trade** is reported as a commission
estimate, so you can see the round-trip cost of the plan.

## Options

- **Avoid selling (buy-only).** Any listed asset above its target isn't sold; it is
  held (shown as "held — above tgt") and lets its weight drift.

## The model

Listed assets carry `w` (over the invested amount `C`) and `t` (over the final
total `S`); the unlisted / blank-target rest is the held bucket. Given the final
total `S` you enter, the invested amount is backed out and the trades follow:

```
C  = S · (1 − Σt) / (1 − Σw)      (formula 1, inverted to take S as the input)
xᵢ = tᵢ · S − wᵢ · C             (trade for asset i; negative = sell)
total to invest = S − C          ( = Σ xᵢ exactly — nothing is left undeployed)
```

This needs a held rest: `Σw < 100%` and `Σt < 100%` (list only the subset you're
rebalancing). The held bucket dilutes to `(1 − Σt)` without being traded.

## Checks

- Warns if there's no held rest (current or target weights sum to ≥ 100%), since
  the formula then has no bucket to absorb the rebalancing.

## Files

- `index.html` — markup and styling only.
- `rebalance.js` — the pure math (`planFromS`, plus the older `plan`/`planCash`/
  `planInvest`). No DOM; runs in the browser and in Node, so page and tests share it.
- `app.js` — DOM wiring: reads inputs, calls `Rebalance.planFromS`, renders.
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
