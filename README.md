# RSI

Recursive Self Investing. A static desk that follows the Alpha Desk playbook: capital map, thesis cards, a daily brief, and the recursive loop.

Not financial advice. The app suggests. It does not place trades or connect to a brokerage.

Live site, after the Pages workflow runs on `main`: https://vellumpress.github.io/rsi/

## What it does

- Split a funded amount into core 30%, conviction 45%, and dry powder 25%. Theme counts are 3, 4, or 5. One or two themes are capped at 15% of the book.
- Walk a theme through the loop: scout, thesis card, red team, valuation band, then the entry third only.
- Run the page-3 engine every day and mark Friday as the full sweep. Circuit breaker first. The first rule that fires is the action.
- Keep a versioned rulebook. One threshold change per quarter. No threshold change while the book is below its peak. After four quarters, a conviction sleeve that trails QQQ can be shrunk into the core.
- Store the desk in this browser. Export and import JSON. A backup is written before an import or a migration from an older Alpha Desk file.

## Data

Weekday prices come from the Yahoo Finance chart API (`query1.finance.yahoo.com`), fetched by `.github/workflows/prices.yml` into `public/prices.json`. The browser cannot call Yahoo directly because Yahoo does not send a CORS header. A refresh says so, and falls back to the published snapshot at `raw.githubusercontent.com`. Valuation percentile is entered by hand. A missing, stale, jumped, or non-positive quote does not size an order.

The price workflow only commits `public/prices.json`. A bot push does not redeploy GitHub Pages. The client reads the raw snapshot so a new file can land without a Pages deploy. The next human push to `main` publishes the site itself.

## Develop

```bash
npm ci
npm test
npm run lint
npm run build
```

`npm run prices` refreshes `public/prices.json` from Yahoo.

## Limits

- US market holidays are not in the two-trading-day staleness check. Only weekends are skipped.
- T-bill yield is not accrued. Cash is carried at par.
- Benchmark returns use the first SPY and QQQ prices this browser recorded, not a backfilled history.
- The 200-day average and the 52-week fear test are withheld when a symbol has fewer than 200 closes. A kill can still be sized from a sane last price.
- A price that jumps more than 40% versus the prior adjusted close is rejected rather than traded.
- Capital above $100,000,000 is rejected.
- v1.0 trims 20% of a greedy position, the low end of the playbook's 20–25% band.
- An extra dry-powder fear add runs on the Friday sweep only, and not again within 7 days.
- Any mark below the peak locks rule edits, not only the 30% circuit breaker.
