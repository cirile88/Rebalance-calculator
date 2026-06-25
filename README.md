# Rebalance Calculator

A single-file, mobile-friendly web tool that tells you exactly how much of each
asset to buy (or sell) to move a portfolio from its current weights to target
weights. Runs entirely in the browser, saves your inputs on the device, and
needs no backend.

**Live:** https://rebalance-calc-emiliano.netlify.app

## What it does

You enter your **whole account total** `S + C` (the value after any cash you're
adding), the **cash to invest** `S`, and for each asset you want to rebalance its
current weight `w`, target weight `t`, and trading currency — all weights expressed
over the full account, exactly as a broker like IBKR shows them. The tool returns,
per asset:

- the trade `x = (t − w)·(S+C)`, in the base currency, plus its size in the asset's
  own currency (e.g. `buy +1,000 CHF (≈ 1,090 EUR)`),
- the resulting weight after the trade, shown as a bar with a target tick,

plus the cash actually deployed and the account total afterwards.

Two design points that matter:

- **Only listed assets are traded; everything else is held.** You can rebalance a
  subset — unlisted holdings (and rows with a blank target) are never touched and
  are never assumed to be cash.
- **`S` is a hard budget.** If your targets would need more new cash than `S`
  (after reserving fees), the buys are scaled down proportionally to fit, and a
  warning is shown.

## Inputs

- **Total after cash (S + C)** — the account value once your new cash is in it.
- **Cash to invest (S)** — the budget; net buys won't exceed it.
- **Targets as** — enter `w`/`t` as percent or as fractions (0–1).
- **Base currency** — the currency totals and trades are expressed in.
- **Now w / Target t / currency** per asset, all weights **over the full account**.
  Leave a target **blank to hold**. The per-asset currency only sets how the order
  size is displayed; the math is unchanged.

## Currency conversion

Rates are fetched live from [frankfurter.dev](https://frankfurter.dev) (ECB daily
rates, free, no API key, CORS-enabled) when the page loads, when you change the
base currency, or via the ↻ refresh button. They convert each trade from the base
currency into the asset's own currency for display only — so if rates are
unavailable, totals and trades are still correct, just shown in the base currency.
The `.dev` host is used directly because the older `.app` host 301-redirects and
the redirect drops CORS headers, which fails the fetch in the browser.

## Fees

A flat **2 (base currency) is reserved per suggested trade** as a commission
buffer, deducted from the budget `S` before sizing buys, so the plan never spends
cash it doesn't have on fees.

## Options

- **Avoid selling (buy-only).** Any asset above its target can't be sold; it is
  held (shown as "held — above tgt") and only the underweight assets are bought.

## The model

All weights are over the full account total `T = S + C`. For each listed asset:

```
xᵢ = (tᵢ − wᵢ) · T            (trade for asset i; negative = sell)
```

Unlisted assets (and blank-target rows) are held. Net new cash = Σ buys − Σ sells.
If that exceeds the budget `S` (after fees), every buy is multiplied by
`(S − fees + sells) / buys` so the net spend equals `S` exactly.

## Checks

- Warns when targets need more new cash than the budget `S` (buys are scaled to
  fit), and if any single target exceeds 100% of the account.

## Files

- `index.html` — markup and styling only.
- `rebalance.js` — the pure math (`planInvest`, plus the older `plan`/`planCash`).
  No DOM; runs in the browser and in Node, so the page and tests share logic.
- `app.js` — DOM wiring: reads inputs, calls `Rebalance.planInvest`, renders.
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
