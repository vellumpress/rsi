import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STARTER_UNIVERSE, runOnboard, type StoredPlan } from "../src/lib/onboardPlan";
import { assessQuote } from "../src/lib/quotes";
import { chartSeries, quoteAsOf, yahooChartUrl, type ChartSeries } from "../src/lib/yahoo";
import { asUser, bootRsiDatabase } from "./postgres";
import type { PGlite } from "@electric-sql/pglite";

const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const AMOUNT = 250_000;

/**
 * Real runOnboard, real Yahoo charts, real Postgres (the shipped migrations on PGlite).
 * Grok is a live api.x.ai call when XAI_API_KEY is set. Otherwise the recorded
 * message content in e2e/fixtures/grok-starter-plan.json is the only stand-in,
 * and it replaces completeJson only.
 */
describe("today's plan", () => {
  it("sizes a real plan and records one fill", async () => {
    const liveGrok = Boolean(process.env.XAI_API_KEY);
    const cache = new Map<string, unknown>();
    for (const ticker of STARTER_UNIVERSE) {
      const response = await fetch(yahooChartUrl(ticker), { headers: { "user-agent": "rsi-e2e/1.0" } });
      expect(response.ok, ticker).toBe(true);
      cache.set(ticker, await response.json());
    }
    const sample = chartSeries(cache.get("AAPL"), "AAPL");
    const today = sessionFor(sample);
    const series = new Map<string, ChartSeries>();
    for (const ticker of STARTER_UNIVERSE) {
      series.set(ticker, chartSeries(cache.get(ticker), ticker));
    }

    const db = await bootRsiDatabase();
    await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'miketankh@gmail.com'), ('${STRANGER}', 'other@example.com')`);

    const result = await runOnboard({
      userId: OWNER,
      amount: AMOUNT,
      today,
      fetchChart: async (ticker) => {
        const payload = cache.get(ticker);
        if (!payload) throw new Error(`missing ${ticker}`);
        return payload;
      },
      completeJson: (prompt) => grokContent(prompt, liveGrok),
      save: (plan) => persist(db, plan),
    });
    expect(result.ok, !result.ok ? result.error : "").toBe(true);
    if (!result.ok) return;

    const tickers = result.plan.orders.map((order) => order.ticker);
    expect(new Set(tickers).size).toBe(tickers.length);
    expect(result.plan.orders.filter((order) => order.rule === "CORE-T1")).toHaveLength(8);
    const themes = result.plan.orders.filter((order) => order.rule === "CONV-T1");
    expect(themes.length).toBeGreaterThanOrEqual(3);
    expect(themes.length).toBeLessThanOrEqual(5);
    if (!liveGrok) {
      expect(tickers).toEqual(["AAPL", "MSFT", "GOOGL", "AMZN", "JPM", "JNJ", "XOM", "CAT", "NVDA", "META", "COST", "UNH"]);
    }
    for (const order of result.plan.orders) {
      expect(STARTER_UNIVERSE).toContain(order.ticker);
      expect(order.side).toBe("buy");
      expect(Number.isInteger(order.shares)).toBe(true);
      expect(order.shares).toBeGreaterThanOrEqual(1);
      expect(order.dollars).toBeLessThanOrEqual(AMOUNT * 0.15);
      expect(order.dollars).toBeCloseTo(Math.round(order.shares * order.reference_price * 100) / 100, 2);
      expect(order.reason).toMatch(/Not a fill/);
      const quote = quoteAsOf(series.get(order.ticker) as ChartSeries, today);
      expect(order.reference_price).toBe(quote.price);
      const check = assessQuote(
        { price: quote.price, previousClose: quote.previousClose, asOf: quote.asOf, bars: quote.bars },
        today,
      );
      expect(check.block === "ok" || check.block === "short").toBe(true);
    }
    expect(tickers).not.toContain("SPY");
    expect(tickers).not.toContain("QQQ");
    expect(result.plan.cash).toBeGreaterThan(AMOUNT * 0.7);

    await db.exec("reset role");
    await db.exec("set role service_role");
    const stored = await db.query<{ ticker: string; shares: string; reference_price: string; n: string }>(
      `select ticker, shares::text as shares, reference_price::text as reference_price, (select count(*) from public.fills)::text as n from public.recommendations order by created_at`,
    );
    expect(stored.rows.every((row) => row.n === "0")).toBe(true);
    expect(stored.rows.map((row) => row.ticker)).toEqual(tickers);
    const profile = await db.query<{ capital: string }>(`select capital::text as capital from public.profiles`);
    expect(Number(profile.rows[0].capital)).toBe(AMOUNT);

    const first = await db.query<{ id: string; shares: string; reference_price: string; ticker: string; noted_on: string }>(
      `select id::text as id, shares::text as shares, reference_price::text as reference_price, ticker, noted_on::text as noted_on
       from public.recommendations order by created_at limit 1`,
    );
    const marked = first.rows[0];
    await asUser(db, OWNER, "miketankh@gmail.com");
    await db.query(
      `insert into public.fills (user_id, ticker, side, shares, price, traded_on, recommendation_id)
       values ($1, $2, 'buy', $3, $4, $5, $6)`,
      [OWNER, marked.ticker, Number(marked.shares), Number(marked.reference_price), marked.noted_on.slice(0, 10), marked.id],
    );
    const own = await db.query<{ ticker: string; shares: string; price: string }>(
      `select ticker, shares::text as shares, price::text as price from public.fills`,
    );
    expect(own.rows).toEqual([{
      ticker: marked.ticker,
      shares: String(Number(marked.shares)),
      price: String(Number(marked.reference_price)),
    }]);

    await asUser(db, STRANGER, "other@example.com");
    const hidden = await db.query(`select id from public.recommendations`);
    expect(hidden.rows).toHaveLength(0);

    const again = await runOnboard({
      userId: OWNER,
      amount: AMOUNT,
      today,
      fetchChart: async (ticker) => cache.get(ticker),
      completeJson: (prompt) => grokContent(prompt, liveGrok),
      save: (plan) => persist(db, plan),
    });
    expect(again.ok).toBe(true);
    await db.exec("reset role");
    await db.exec("set role service_role");
    const kept = await db.query<{ id: string }>(`select id::text as id from public.recommendations where id = $1`, [marked.id]);
    expect(kept.rows).toHaveLength(1);
    const count = await db.query<{ n: string }>(`select count(*)::text as n from public.recommendations`);
    expect(Number(count.rows[0].n)).toBe((again.ok ? again.plan.orders.length : 0) + 1);
  });
});

function sessionFor(series: ChartSeries): string {
  const utc = new Date().toISOString().slice(0, 10);
  const quote = quoteAsOf(series, utc);
  const check = assessQuote(
    { price: quote.price, previousClose: quote.previousClose, asOf: quote.asOf, bars: quote.bars },
    utc,
  );
  if (check.block === "stale" || check.block === "invalid" || check.block === "missing") {
    const last = series.bars.at(-1)?.date;
    if (!last) throw new Error("Yahoo returned no AAPL session.");
    return last;
  }
  return utc;
}

async function grokContent(prompt: string, live: boolean): Promise<string> {
  expect(prompt).toContain("Starter universe");
  if (!live) return readFileSync("e2e/fixtures/grok-starter-plan.json", "utf8");
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.RSI_MODEL?.trim() || "grok-4.7",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Reply with JSON only. Do not include prices or share counts." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Grok HTTP ${response.status}`);
  const body = await response.json() as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error("Grok returned no content");
  return text;
}

async function persist(db: PGlite, plan: StoredPlan): Promise<void> {
  await db.exec("reset role");
  await db.exec("set role service_role");
  await db.query(
    `insert into public.profiles (user_id, capital, noted_on)
     values ($1, $2, $3)
     on conflict (user_id) do update set capital = excluded.capital, noted_on = excluded.noted_on, updated_at = now()`,
    [plan.userId, plan.amount, plan.notedOn],
  );
  const ids: string[] = [];
  for (const order of plan.orders) {
    const inserted = await db.query<{ id: string }>(
      `insert into public.recommendations
        (user_id, noted_on, ticker, side, rule, probability, expected_outcome, inputs, reference_price, shares, dollars, reason)
       values ($1, $2, $3, $4, $5, null, $6, $7::jsonb, $8, $9, $10, $11)
       returning id::text as id`,
      [
        order.user_id,
        order.noted_on,
        order.ticker,
        order.side,
        order.rule,
        order.expected_outcome,
        JSON.stringify(order.inputs),
        order.reference_price,
        order.shares,
        order.dollars,
        order.reason,
      ],
    );
    ids.push(inserted.rows[0].id);
  }
  const filled = await db.query<{ id: string }>(
    `select recommendation_id::text as id from public.fills where user_id = $1 and recommendation_id is not null`,
    [plan.userId],
  );
  const keep = [...ids, ...filled.rows.map((row) => row.id)];
  const list = keep.map((id) => `'${id}'`).join(", ");
  await db.exec(`delete from public.recommendations where user_id = '${plan.userId}' and id not in (${list})`);
}
