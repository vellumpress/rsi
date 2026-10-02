import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addDays, addMonths, nextFriday, weekdayUTC } from "../src/lib/dates";
import { classifyInstrument } from "../src/lib/instruments";
import { parseOnboardFixture, walkTimeline } from "../src/lib/cycle";
import { chatCompletionRequest } from "../src/lib/llm";
import { wholeBuy } from "../src/lib/wholeShares";
import { chartSeries, quoteAsOf, yahooChartUrl, type ChartSeries } from "../src/lib/yahoo";
import { asUser, bootRsiDatabase } from "./postgres";

const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const TICKERS = ["AAPL", "MSFT", "XOM", "SPY", "QQQ"] as const;

describe("full desk loop", () => {
  it("blocks signup and sign-in except the allowlisted email", async () => {
    const db = await bootRsiDatabase();
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'miketankh@gmail.com'), ('${STRANGER}', 'other@example.com')`);

    await db.exec("reset role");
    await db.exec("set role supabase_auth_admin");
    const allowed = await db.query<{ result: { error?: { message?: string; http_code?: number } } }>(
      `select public.hook_before_user_created($1::jsonb) as result`,
      [JSON.stringify({ user: { email: "MikeTankh@gmail.com" } })],
    );
    expect(allowed.rows[0].result).toEqual({});
    const blocked = await db.query<{ result: { error?: { message?: string; http_code?: number } } }>(
      `select public.hook_before_user_created($1::jsonb) as result`,
      [JSON.stringify({ user: { email: "other@example.com" } })],
    );
    expect(blocked.rows[0].result.error?.message).toBe("This RSI desk is private.");
    expect(blocked.rows[0].result.error?.http_code).toBe(403);

    await db.exec("reset role");
    await db.exec("set role service_role");
    await db.query(
      `insert into public.user_feedback (user_id, noted_on, tag, body, constraint_patch) values ($1, '2026-10-02', 'exclusion', $2, $3::jsonb)`,
      [OWNER, "I don't want exposure to oil", JSON.stringify({ excludeThemes: ["oil"], excludeTickers: [], maxNewTrades: null, plainLanguage: false, risk: null })],
    );

    await asUser(db, OWNER, "miketankh@gmail.com");
    const ownList = await db.query<{ email: string }>(`select email from public.allowlist`);
    expect(ownList.rows.map((row) => row.email)).toEqual(["miketankh@gmail.com"]);
    const ownNotes = await db.query<{ tag: string; body: string }>(`select tag, body from public.user_feedback`);
    expect(ownNotes.rows).toEqual([{ tag: "exclusion", body: "I don't want exposure to oil" }]);
    await db.query(
      `insert into public.fills (user_id, ticker, side, shares, price, traded_on) values ($1, 'AAPL', 'buy', 10, 100, '2026-10-02')`,
      [OWNER],
    );
    const fills = await db.query<{ ticker: string; shares: string }>(`select ticker, shares::text as shares from public.fills`);
    expect(fills.rows).toEqual([{ ticker: "AAPL", shares: "10" }]);
    await expect(
      db.query(`insert into public.fills (user_id, ticker, side, shares, price, traded_on) values ($1, 'SPY', 'buy', 1, 400, '2026-10-02')`, [OWNER]),
    ).rejects.toThrow(/fills_not_benchmark|check/i);

    await asUser(db, STRANGER, "other@example.com");
    const hidden = await db.query(`select email from public.allowlist`);
    expect(hidden.rows).toEqual([]);
    const hiddenNotes = await db.query(`select body from public.user_feedback`);
    expect(hiddenNotes.rows).toEqual([]);
    await expect(
      db.query(`insert into public.fills (user_id, ticker, side, shares, price, traded_on) values ($1, 'AAPL', 'buy', 1, 100, '2026-10-02')`, [STRANGER]),
    ).rejects.toThrow(/row-level security|policy/i);
    await db.close();
  });

  it("prices a few large-caps from Yahoo and runs the year, including Boss feedback", async () => {
    const fixture = parseOnboardFixture(JSON.parse(readFileSync("e2e/fixtures/onboard.json", "utf8")));
    expect(fixture.ok).toBe(true);
    if (!fixture.ok) return;
    const live = chatCompletionRequest({
      model: "grok-4.7",
      temperature: 0.2,
      messages: [{ role: "system", content: "Return the onboarding strategy as JSON." }, { role: "user", content: "100000" }],
      responseFormat: { type: "json_object" },
    });
    expect(live.model).toBe("grok-4.7");
    expect(live.response_format).toEqual({ type: "json_object" });
    expect(Object.keys(live).sort()).toEqual(["messages", "model", "response_format", "temperature"]);

    const series = await Promise.all(TICKERS.map((ticker) => fetchSeries(ticker)));
    const aapl = series.find((item) => item.ticker === "AAPL");
    const spy = series.find((item) => item.ticker === "SPY");
    expect(aapl && spy).toBeTruthy();
    if (!aapl || !spy) return;
    const latest = quoteAsOf(aapl, aapl.bars.at(-1)?.date ?? "2026-10-02");
    expect(latest.price).toBeGreaterThan(0);
    expect(classifyInstrument({ ticker: "AAPL", instrumentType: aapl.instrumentType, quoteType: aapl.quoteType })).toBe("equity");
    expect(classifyInstrument({ ticker: "SPY", instrumentType: spy.instrumentType, quoteType: spy.quoteType })).toBe("etf");
    const order = wholeBuy(5_000, latest.price);
    expect(order).not.toBeNull();
    expect(order && Number.isInteger(order.shares) && order.shares >= 1).toBe(true);
    expect(order && order.dollars).toBe(Math.round((order?.shares ?? 0) * (latest.price ?? 0) * 100) / 100);

    const last = aapl.bars.at(-1)?.date ?? "2026-10-02";
    const start = nextFriday(addMonths(last, -13));
    const extended = series.map((item) => extendFlat(item, addDays(last, 14)));
    const result = walkTimeline({ amount: 100_000, start, series: extended, fixture: fixture.fixture });
    const fridays = Object.keys(result.ordersByDate);
    const first = result.ordersByDate[fridays[0]];
    expect(first.some((row) => row.ticker === "AAPL" && Number.isInteger(row.shares) && row.shares >= 1)).toBe(true);
    expect(first.find((row) => row.ticker === "AAPL")?.price).toBeGreaterThan(0);
    expect(result.ordersByDate[fridays[1]].some((row) => row.ticker === "XOM")).toBe(false);
    expect(result.state.trades.some((trade) => trade.ticker === "AAPL" && trade.side === "buy")).toBe(true);
    expect(result.state.trades.some((trade) => trade.ticker === "SPY" || trade.ticker === "QQQ")).toBe(false);
    expect(result.events.some((event) => event.kind === "scorecard")).toBe(true);
    expect(result.events.find((event) => event.kind === "postmortem")?.detail).toMatch(/skill/);
    expect(result.events.find((event) => event.kind === "rule-change")?.detail).toMatch(/1\.1/);
    expect(result.events.find((event) => event.kind === "drawdown-lock")?.detail).toMatch(/locked/);
    expect(result.events.find((event) => event.kind === "rollback")?.detail).toMatch(/Rolled back/);
    expect(result.events.find((event) => event.kind === "meta-rule")?.detail).toMatch(/shrink/);
    expect(result.state.rulebook.thresholds.positionCap).toBe(0.15);
    expect(result.attack.message).toMatch(/immutable/);
    expect(result.boss?.prompt).toMatch(/Engine log,/);
    expect(result.feedback.some((item) => item.tag === "exclusion")).toBe(true);

    const db = await bootRsiDatabase();
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'miketankh@gmail.com')`);
    await db.exec("set role service_role");
    for (const item of result.feedback) {
      await db.query(
        `insert into public.user_feedback (user_id, noted_on, tag, body, constraint_patch) values ($1, $2, $3, $4, $5::jsonb)`,
        [OWNER, item.date, item.tag, item.text, JSON.stringify(item.constraint)],
      );
    }
    await asUser(db, OWNER, "miketankh@gmail.com");
    const stored = await db.query<{ tag: string }>(`select tag from public.user_feedback order by created_at`);
    expect(stored.rows.map((row) => row.tag)).toEqual(result.feedback.map((item) => item.tag));
    await db.close();
  });
});

async function fetchSeries(ticker: string): Promise<ChartSeries> {
  let lastError = "Yahoo did not answer.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(yahooChartUrl(ticker), { headers: { "user-agent": "rsi-e2e/1.0" } });
      if (!response.ok) {
        lastError = `Yahoo responded ${response.status} for ${ticker}.`;
        continue;
      }
      const series = chartSeries(await response.json(), ticker);
      if (series.bars.length > 200 && series.bars.at(-1)?.close) return series;
      lastError = `${ticker} returned ${series.bars.length} bars.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  throw new Error(lastError);
}

function extendFlat(series: ChartSeries, through: string): ChartSeries {
  const last = series.bars.at(-1);
  if (!last || last.date >= through) return series;
  const bars = series.bars.slice();
  let date = addDays(last.date, 1);
  while (date <= through) {
    const day = weekdayUTC(date);
    if (day !== 0 && day !== 6) bars.push({ date, close: last.close, high: last.high });
    date = addDays(date, 1);
  }
  return { ...series, bars };
}
