# RSI

Recursive Self Investing. A static desk that follows the Alpha Desk playbook, with one deliberate override: it recommends only individual stocks. It does not recommend an index fund, an ETF, or T-bills.

Not financial advice. The app suggests. It does not place trades or connect to a brokerage.

Live site, after the Pages workflow runs on `main`: https://vellumpress.github.io/rsi/

## Deviation from the playbook

The playbook PDF puts the 30% core sleeve in a broad index, holds dry powder and unspent tranches in T-bills, and moves a trailing conviction sleeve into that index. This desk does not.

- Core is a basket of individual large-cap stocks the user types. It starts empty. Nothing in the app is a stock pick. The default size is 8 equal-weight names, editable (about 8–10). Each name is bought in three monthly tranches and the basket is rebalanced yearly. No single name can be bought through 15% of the book. Unfilled slots stay in cash.
- Dry powder (25%) and earmarked unspent tranches are uninvested cash. Exit and trim proceeds go to cash.
- A buy is sized only when Yahoo chart meta says the symbol is `EQUITY`. `ETF` and `MUTUALFUND` are blocked. If the type is missing, the buy is blocked rather than guessed.
- SPY and QQQ are fetched for comparison only: the whole book versus SPY, themes and the four-quarter test versus QQQ. They never appear as a buy or a sell. Signals use the position itself, not a theme ETF.
- If the conviction sleeve trails QQQ after four quarters, that capital is directed into the core stock basket.

The page-3 engine order is unchanged: circuit breaker first, then kill, greed or the 20% line, a missed milestone, fear (all three signals), confirmation on reported numbers, otherwise hold. v1.0 still trims 20% of a greedy position, the low end of the 20–25% band.

Rule edits lock when the marked book is down 10% or more from its peak, and when the book cannot be marked. A tick under the high is not treated as a drawdown: that would lock the rulebook on almost every day, so the quarterly change could not be used. Ten percent is a real drawdown, and it locks earlier than the 30% circuit breaker that freezes adds. Missing marks stay locked.

## What it does

- Split a funded amount into core 30%, conviction 45%, and dry powder 25%. Theme counts are 3, 4, or 5. One or two themes are capped at 15% of the book.
- Walk a theme through the loop: scout, thesis card, red team, valuation band, then the entry third only. The scout ticker has to be one company. SPY and QQQ are refused.
- Run the page-3 engine every day and mark Friday as the full sweep. Circuit breaker first. The first rule that fires is the action.
- Keep a versioned rulebook. One threshold change per quarter. No threshold change in a 10% drawdown or while the book is unmarked. After four quarters, a conviction sleeve that trails QQQ can be shrunk into the core stock basket.
- Store the desk in this browser. Export and import JSON. A backup is written before an import or a migration from an older Alpha Desk file. An imported `coreTicker` of SPY or QQQ is dropped.

## Data

Weekday prices come from the Yahoo Finance chart API (`query1.finance.yahoo.com`), fetched by `.github/workflows/prices.yml` into `public/prices.json`. The browser cannot call Yahoo directly because Yahoo does not send a CORS header. A refresh says so, and falls back to the published snapshot at `raw.githubusercontent.com`. Valuation percentile is entered by hand. A missing, stale, jumped, or non-positive quote does not size an order. The staleness check skips weekends and NYSE full-day holidays.

The committed snapshot prices SPY and QQQ so the scorecard has benchmarks. Add a company's ticker to `config/watchlist.json` before the daily job can classify it as `EQUITY` and the brief can size a buy. The watchlist is a fetch list, not a recommendation.

The price workflow only commits `public/prices.json`. It uses the default `GITHUB_TOKEN`, so that bot push does not start another workflow run and does not redeploy GitHub Pages. The client reads the raw snapshot so a new file can land without a Pages deploy. The next human push to `main` publishes the site itself. Pages is built with base path `/rsi/` and is served at https://vellumpress.github.io/rsi/.

## Sign in and Grok

The desk is private. Sign up and sign in with email and password. Supabase Auth keeps the refresh token in this browser (`rsi.auth`), refreshes the access token, and sends that token to the edge functions. There is no passcode and no place to paste an xAI key. A leftover `rsi.llm` value is deleted on load.

Only addresses in `public.allowlist` can get past signup or spend credits. The table is seeded with `miketankh@gmail.com`. The before-user-created hook rejects every other signup. Row security lets a signed-in user read only their own allowlist row. `rsi-chat`, `rsi-onboard`, and `rsi-daily` check the list again and return `403` with "This RSI desk is private." before any model call. Someone who is not on the list sees that same sentence and cannot open the desk.

Chat is with the Boss. The server prepends a system message the browser cannot override: no trades, no invented prices, no edits to an immutable rule. A request to change a rule is stored and the Boss says it waits for the quarterly review. Other feedback (an exclusion, pace, voice, risk) is tagged and dated in `user_feedback`. Constraints apply on the next engine run. Notes stay in `rsi.feedback`, not in the desk export.

Chat and thesis generation call `rsi-chat` with the session. The function verifies the JWT, checks the allowlist, stores any feedback, then allows 12 calls a minute and 80 a day. The server holds `XAI_API_KEY` and calls `grok-4.7` (override with the `RSI_MODEL` secret). Pass `stream: true` for a server-sent reply. The browser never sees the key.

`npm run e2e` reruns the whole loop. `supabase start` needs Docker, which this desk does not assume. The suite applies `supabase/migrations/20261002203818_rsi_schema.sql` on embedded Postgres with the auth hooks a local stack would provide, fetches real Yahoo charts for AAPL, MSFT, XOM, SPY, and QQQ, and time-travels a funded desk through Friday sweeps.

## Deploy

Project ref `ojntnbaakfowmnrsetbb`. Apply these in order. Do not run them against any other project.

1. In the SQL editor, run `supabase/migrations/20261002203818_rsi_schema.sql`.
2. Authentication → Hooks → Before user created → Postgres function `public.hook_before_user_created`. Enable it. `config.toml` records the same hook, but this project is updated from the dashboard, not `supabase config push`.
3. Authentication → URL configuration. Site URL `https://vellumpress.github.io/rsi/`. Add that URL under redirect URLs.
4. Confirm the secret `XAI_API_KEY` is set. Do not put it in the frontend. Optional secret `RSI_MODEL` (default `grok-4.7`). `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are already present in functions.
5. Deploy each function as the single file `index.ts` (Management API multipart, metadata `entrypoint_path` `index.ts`):
   - `rsi-chat` with `verify_jwt` true. File `supabase/functions/rsi-chat/index.ts`.
   - `rsi-onboard` with `verify_jwt` true. File `supabase/functions/rsi-onboard/index.ts`.
   - `rsi-daily` with `verify_jwt` false. File `supabase/functions/rsi-daily/index.ts`. It rejects any caller except the service role and skips accounts that are not on the allowlist. It does not call xAI.
6. Delete the passcode function `rsi-grok`. It is not on the allowlist path and can still spend credits.
7. Build the site with `VITE_SUPABASE_URL=https://ojntnbaakfowmnrsetbb.supabase.co` and `VITE_SUPABASE_ANON_KEY` set to the anon key. The anon key is safe in the frontend. The service role is not.

## Homepage and Grok

The homepage shows today's actions, the Friday sweep, the month's scorecard, the book against its peak and against SPY and QQQ, and the newest thesis. Research, the ledger, the rulebook, and settings sit behind the nav.

The chat can explain the book and propose a trade or a thesis. A proposal is not a write. Confirming a trade still runs the same caps, stocks-only check, and ledger guards.

Generate thesis runs the page-2 scout, the page-5 card, and a separate red team, using the rule summary in `src/lib/playbookSummary.ts`. Output is JSON, ETFs are rejected, snapshot prices are not invented, and model figures are labeled "model-generated, verify". The saved card is a draft. Approving it is a later click on the research page, and that click still does not trade until you confirm an entry. A new ticker is not committed from the browser. Download `watchlist.json` or edit [config/watchlist.json](https://github.com/vellumpress/rsi/edit/main/config/watchlist.json). A monthly pitch on the brief is a prompt, not an automatic scout.

## Develop

```bash
npm ci
npm test
npm run e2e
npm run lint
npm run build
```

`npm run prices` refreshes `public/prices.json` from Yahoo. It always fetches SPY and QQQ, plus whatever equities are listed in `config/watchlist.json`.

## Limits

- Cash is carried at par. It is not invested, and no yield is accrued.
- Benchmark returns use the first SPY and QQQ prices this browser recorded, not a backfilled history.
- The 200-day average and the 52-week fear test are withheld when a symbol has fewer than 200 closes. A kill can still be sized from a sane last price when the symbol is an equity.
- A price that jumps more than 40% versus the prior adjusted close is rejected rather than traded.
- Capital above $100,000,000 is rejected.
- v1.0 trims 20% of a greedy position, the low end of the playbook's 20–25% band.
- An extra cash fear add runs only after tranches 2 and 3 are both done, only on the Friday sweep, and not again within 7 days.
- A buy of a symbol the snapshot has not marked `EQUITY` is refused.
