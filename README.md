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

## What the screen does

One screen. Sign in, enter how much to invest, and read today's orders.

`rsi-onboard` stores the amount, fetches Yahoo prices for the starter universe in `src/lib/onboardPlan.ts` (AAPL, MSFT, GOOGL, AMZN, NVDA, META, JPM, JNJ, UNH, XOM, COST, CAT), and asks Grok (`grok-4.7`) to pick 8 core names and 3–5 themes from that list. The code rejects anything outside the list, then sizes the plan: 30% core, 45% conviction bought in thirds (only the first third today), 25% cash, 15% cap per name, whole shares. A stale, jumped, missing, or non-equity price stores nothing and the screen shows the error instead of orders. SPY and QQQ are not in the universe.

The list is ticker, BUY or SELL, whole shares, reference price, dollar amount, and a one-line reason. **Mark as done** writes a fill. The app never places a trade. The same amount on the same day returns the stored plan and does not call Grok again. A different amount builds a new plan. **Rebuild** does that only after a confirm, and a fill already recorded today blocks a new plan until that confirm.

A Boss box under the list calls `rsi-chat`. The server loads the stored plan into the system message. The browser does not send the orders.

The engine, scorecards, rulebook, and settings screens are not mounted. Their modules stay in the repo.

## Data

Weekday prices come from the Yahoo Finance chart API (`query1.finance.yahoo.com`), fetched by `.github/workflows/prices.yml` into `public/prices.json`. The browser cannot call Yahoo directly because Yahoo does not send a CORS header. A refresh says so, and falls back to the published snapshot at `raw.githubusercontent.com`. Valuation percentile is entered by hand. A missing, stale, jumped, or non-positive quote does not size an order. The staleness check skips weekends and NYSE full-day holidays.

The committed snapshot prices SPY and QQQ so the scorecard has benchmarks. Add a company's ticker to `config/watchlist.json` before the daily job can classify it as `EQUITY` and the brief can size a buy. The watchlist is a fetch list, not a recommendation.

The price workflow only commits `public/prices.json`. It uses the default `GITHUB_TOKEN`, so that bot push does not start another workflow run and does not redeploy GitHub Pages. The client reads the raw snapshot so a new file can land without a Pages deploy. The next human push to `main` publishes the site itself. Pages is built with base path `/rsi/` and is served at https://vellumpress.github.io/rsi/.

## Sign in and Grok

The desk is private. Sign up and sign in with email and password. Supabase Auth keeps the refresh token in this browser (`rsi.auth`), refreshes the access token, and sends that token to the edge functions. There is no passcode and no place to paste an xAI key. A leftover `rsi.llm` value is deleted on load.

Only addresses in `public.allowlist` can get past signup or spend credits. The table is seeded with `miketankh@gmail.com`. The before-user-created hook rejects every other signup. Row security lets a signed-in user read only their own allowlist row. `rsi-chat`, `rsi-onboard`, and `rsi-daily` check the list again and return `403` with "This RSI desk is private." before any model call. Someone who is not on the list sees that same sentence and cannot open the desk.

`rsi-onboard` calls Grok only after that allowlist check, and only to pick names. Prices come from Yahoo. `rsi-daily` is still a placeholder and does not call xAI.

Chat is with the Boss. The server prepends a system message the browser cannot override: no trades, no invented prices, no edits to an immutable rule. A request to change a rule is stored and the Boss says it waits for the quarterly review. Other feedback (an exclusion, pace, voice, risk) is tagged and dated in `user_feedback`. Constraints apply on the next engine run. Notes stay in `rsi.feedback`, not in the desk export.

Chat and thesis generation call `rsi-chat` with the session. The function verifies the JWT, checks the allowlist, stores any feedback, then allows 12 calls a minute and 80 a day. The server holds `XAI_API_KEY` and calls `grok-4.7` (override with the `RSI_MODEL` secret). Pass `stream: true` for a server-sent reply. The browser never sees the key.

`npm run e2e` applies every file in `supabase/migrations` on embedded Postgres (PGlite). Docker is not required, and `supabase start` is not what the suite runs. The plan test calls `runOnboard` with live Yahoo charts for the starter universe. Grok is a live `api.x.ai` call when `XAI_API_KEY` is set; otherwise the test uses the recorded JSON content in `e2e/fixtures/grok-starter-plan.json` at the `completeJson` boundary only. The older timeline test still fetches AAPL, MSFT, XOM, SPY, and QQQ.

## Deploy

Project ref `ojntnbaakfowmnrsetbb`. Apply these in order. Do not run them against any other project.

1. `supabase/migrations/20261002203818_rsi_schema.sql` is already applied. Do not edit it and do not run it again.
2. In the SQL editor, run `supabase/migrations/20261003000000_plan.sql`. That adds `public.profiles` and grants `service_role` delete on unfilled recommendations.
3. Authentication → Hooks → Before user created → Postgres function `public.hook_before_user_created`. It should already be enabled. Leave it. Do not `supabase config push`.
4. Authentication → URL configuration. Site URL `https://vellumpress.github.io/rsi/`. Add that URL under redirect URLs.
5. Secret `XAI_API_KEY` (required for onboard and chat). Optional secret `RSI_MODEL` (default `grok-4.7`). `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected into functions. The service role is the `sb_secret_...` key, not a user JWT, and it is not committed.
6. Deploy each function as the single file `index.ts` (Management API multipart, metadata `entrypoint_path` `index.ts`):
   - `rsi-onboard` with `verify_jwt` true. File `supabase/functions/rsi-onboard/index.ts` (built by `npm run bundle:functions` from `entry.ts`).
   - `rsi-chat` with `verify_jwt` true. File `supabase/functions/rsi-chat/index.ts`. Redeploy so the Boss reads today's plan.
   - `rsi-daily` with `verify_jwt` false. File `supabase/functions/rsi-daily/index.ts`. Unchanged placeholder. It does not call xAI. No cron.
7. Delete `rsi-grok` if it is still deployed.
8. GitHub Pages builds with the committed `.env.production` anon key (`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` only). Do not add `VITE_` secrets to the workflow. Do not put the service role in the workflow or in `.env.production`.

## Homepage and Grok

The signed-in page is the amount, today's orders, and the Boss. Grok on onboard returns names only. `rsi-chat` answers questions about the stored plan and still refuses trades, invented prices, and edits to an immutable rule.

The page-2 scout, thesis cards, the engine, and the rulebook remain in the codebase and in the unit tests. They are not on this screen.

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
