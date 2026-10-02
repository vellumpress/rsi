import { describe, expect, it } from "vitest";
import { addDays, weekdayUTC } from "./dates";
import { FEEDBACK_KEY, loadFeedback, saveFeedback } from "./feedbackStore";
import { defaultState, serializeState } from "./storage";
import { validatePostmortem } from "./postmortem";
import { feedbackChangesNextRun, fundDesk, parseOnboardFixture, walkTimeline, type OnboardFixture } from "./cycle";
import type { ChartSeries } from "./yahoo";

const fixture: OnboardFixture = {
  core: [
    name("AAPL", "hardware"),
    name("MSFT", "software"),
  ],
  conviction: [name("XOM", "oil")],
};

describe("closed loop", () => {
  it("refuses a bad amount and a fund in the strategy", () => {
    expect(fundDesk(0, "2025-10-03").ok).toBe(false);
    expect(fundDesk(100_000_001, "2025-10-03").ok).toBe(false);
    const spy = parseOnboardFixture({ core: [{ ...name("SPY", "index"), instrumentType: "ETF", quoteType: "ETF" }], conviction: [] });
    expect(spy.ok).toBe(false);
    expect(validatePostmortem({ skillOrLuck: "mixed", evidence: "This is long enough to be a sentence." }).ok).toBe(false);
  });

  it("walks a year of Fridays, records a fill, and keeps the rails", () => {
    const result = walkTimeline({ amount: 100_000, start: "2025-10-03", series: book(), fixture });
    const fridays = Object.keys(result.ordersByDate);
    const first = result.ordersByDate[fridays[0]];
    const second = result.ordersByDate[fridays[1]];
    expect(first.some((order) => order.ticker === "AAPL" && order.shares >= 1 && Number.isInteger(order.shares))).toBe(true);
    expect(first.some((order) => order.ticker === "XOM")).toBe(true);
    expect(second.some((order) => order.ticker === "XOM")).toBe(false);
    expect(result.state.trades.some((trade) => trade.ticker === "AAPL")).toBe(true);
    expect(result.state.trades.some((trade) => trade.ticker === "XOM")).toBe(false);
    expect(result.state.trades.every((trade) => Number.isInteger(trade.shares) && trade.price > 0)).toBe(true);
    expect(result.events.some((event) => event.kind === "scorecard")).toBe(true);
    expect(result.events.find((event) => event.kind === "postmortem")?.detail).toMatch(/skill/);
    expect(result.events.find((event) => event.kind === "rule-change")?.detail).toMatch(/1\.1/);
    expect(result.events.find((event) => event.kind === "drawdown-lock")?.detail).toMatch(/locked/);
    expect(result.events.find((event) => event.kind === "rollback")?.detail).toMatch(/Rolled back/);
    expect(result.events.find((event) => event.kind === "meta-rule")?.detail).toMatch(/shrink/);
    expect(result.state.rulebook.version.startsWith("2.")).toBe(true);
    expect(result.state.rulebook.thresholds.positionCap).toBe(0.15);
    expect(result.state.rulebook.thresholds.greedAboveSma).toBe(0.5);
    expect(result.attack.message).toMatch(/immutable/);
    expect(result.attack.positionCap).toBe(0.15);
    expect(result.boss?.citations.join(" ")).toMatch(/Engine log,/);
    expect(result.boss?.prompt).toContain("price unavailable");
    expect(result.feedback.some((item) => item.tag === "exclusion" && item.constraint?.excludeThemes.includes("oil"))).toBe(true);
    const next = feedbackChangesNextRun(first, result.feedback, 0.15);
    expect(next.orders.some((order) => order.ticker === "XOM" || order.theme === "oil")).toBe(false);
    expect(next.positionCap).toBeLessThanOrEqual(0.15);
  });

  it("keeps Boss notes out of the desk export", () => {
    const memory = new Map<string, string>();
    const store = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) };
    saveFeedback(store, [{ id: "f1", date: "2026-10-02", text: "too many trades", tag: "pace", constraint: { excludeTickers: [], excludeThemes: [], maxNewTrades: 1, plainLanguage: false, risk: null } }]);
    expect(loadFeedback(store)).toHaveLength(1);
    expect(serializeState(defaultState("2026-10-02")).includes("too many trades")).toBe(false);
    expect(FEEDBACK_KEY).toBe("rsi.feedback");
  });
});

function name(ticker: string, theme: string) {
  return {
    ticker,
    theme,
    sleeve: "core" as const,
    probability: 60,
    bear: "The bear case is a missed reported number.",
    kill: "Two reported milestones miss.",
    instrumentType: "EQUITY",
    quoteType: "EQUITY",
  };
}

function book(): ChartSeries[] {
  return [
    flat("AAPL", 100, "EQUITY"),
    flat("MSFT", 200, "EQUITY"),
    flat("XOM", 50, "EQUITY"),
    flat("SPY", 400, "ETF"),
    flat("QQQ", 300, "ETF"),
  ];
}

function flat(ticker: string, price: number, instrumentType: string): ChartSeries {
  const bars = [];
  let date = "2024-06-03";
  for (let i = 0; i < 900 && date <= "2026-10-16"; i += 1) {
    const day = weekdayUTC(date);
    if (day !== 0 && day !== 6) bars.push({ date, close: price, high: price * 1.05 });
    date = addDays(date, 1);
  }
  return { ticker, bars, instrumentType, quoteType: instrumentType, currency: "USD" };
}
