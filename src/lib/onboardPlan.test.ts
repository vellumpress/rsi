import { describe, expect, it, vi } from "vitest";
import { addDays, weekdayUTC } from "./dates";
import { ONBOARD_PLAN, parsePlanPick, reuseDecision, runOnboard, STARTER_UNIVERSE } from "./onboardPlan";

const TODAY = "2026-10-02";
const PICK = {
  core: ["AAPL", "MSFT", "GOOGL", "AMZN", "JPM", "JNJ", "XOM", "CAT"],
  themes: [
    { ticker: "NVDA", theme: "semiconductors" },
    { ticker: "META", theme: "software platforms" },
    { ticker: "COST", theme: "retail" },
    { ticker: "UNH", theme: "health plans" },
  ],
};

function sessionsEnding(end: string, count: number): string[] {
  const dates: string[] = [];
  let cursor = end;
  while (dates.length < count) {
    const day = weekdayUTC(cursor);
    if (day !== 0 && day !== 6) dates.push(cursor);
    cursor = addDays(cursor, -1);
  }
  return dates.reverse();
}

function payload(ticker: string, end: string, sessions: number, price: number, instrument = "EQUITY", jump = false): unknown {
  const dates = sessionsEnding(end, sessions);
  const stamps = dates.map((iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d, 18, 0, 0) / 1000;
  });
  const closes = stamps.map((_, index) => (jump && index === stamps.length - 1 ? price * 2 : price));
  return {
    chart: {
      result: [{
        meta: {
          symbol: ticker,
          currency: "USD",
          instrumentType: instrument,
          quoteType: instrument,
          regularMarketPrice: closes.at(-1),
          regularMarketTime: stamps.at(-1),
        },
        timestamp: stamps,
        indicators: {
          quote: [{ high: closes }],
          adjclose: [{ adjclose: closes }],
        },
      }],
    },
  };
}

function charts(end: string, price = 100, instrument = "EQUITY", jump = false) {
  return (ticker: string) => Promise.resolve(payload(ticker, end, 5, price, instrument, jump));
}

describe("onboard plan", () => {
  it("documents twelve individual large caps and leaves the benchmarks out", () => {
    expect(STARTER_UNIVERSE).toHaveLength(12);
    expect(STARTER_UNIVERSE).not.toContain("SPY");
    expect(STARTER_UNIVERSE).not.toContain("QQQ");
    expect(new Set(STARTER_UNIVERSE).size).toBe(12);
  });

  it("refuses a zero or oversized amount before Grok or Yahoo", async () => {
    const completeJson = vi.fn();
    const fetchChart = vi.fn();
    const save = vi.fn();
    const zero = await runOnboard({ userId: "u", amount: 0, today: TODAY, completeJson, fetchChart, save });
    const huge = await runOnboard({ userId: "u", amount: 100_000_001, today: TODAY, completeJson, fetchChart, save });
    expect(zero.ok).toBe(false);
    expect(huge.ok).toBe(false);
    expect(completeJson).not.toHaveBeenCalled();
    expect(fetchChart).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("stores nothing when a name is outside the universe", async () => {
    const save = vi.fn();
    const result = await runOnboard({
      userId: "u",
      amount: 100_000,
      today: TODAY,
      fetchChart: charts(TODAY),
      completeJson: async () => JSON.stringify({ ...PICK, core: ["SPY", ...PICK.core.slice(1)] }),
      save,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/SPY/);
    expect(save).not.toHaveBeenCalled();
  });

  it("stores nothing when any universe price is stale, jumped, or not an equity", async () => {
    const save = vi.fn();
    const completeJson = vi.fn();
    const stale = await runOnboard({
      userId: "u",
      amount: 100_000,
      today: TODAY,
      fetchChart: charts("2026-09-01"),
      completeJson,
      save,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toMatch(/No orders were stored/);
    expect(completeJson).not.toHaveBeenCalled();
    const jumped = await runOnboard({
      userId: "u",
      amount: 100_000,
      today: TODAY,
      fetchChart: charts(TODAY, 100, "EQUITY", true),
      completeJson,
      save,
    });
    expect(jumped.ok).toBe(false);
    const fund = await runOnboard({
      userId: "u",
      amount: 100_000,
      today: TODAY,
      fetchChart: charts(TODAY, 100, "ETF"),
      completeJson,
      save,
    });
    expect(fund.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("buys the first third in whole shares under the 15% cap", async () => {
    const save = vi.fn();
    const result = await runOnboard({
      userId: "user-1",
      amount: 100_000,
      today: TODAY,
      fetchChart: charts(TODAY, 100),
      completeJson: async () => JSON.stringify(PICK),
      save,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.plan.orders).toHaveLength(12);
    expect(result.plan.amount).toBe(100_000);
    expect(result.plan.cash).toBe(75_600);
    for (const order of result.plan.orders) {
      expect(order.side).toBe("buy");
      expect(Number.isInteger(order.shares)).toBe(true);
      expect(order.shares).toBeGreaterThanOrEqual(1);
      expect(order.reference_price).toBe(100);
      expect(order.dollars).toBe(order.shares * 100);
      expect(order.dollars).toBeLessThanOrEqual(15_000);
      expect(order.inputs.plan).toBe(ONBOARD_PLAN);
      expect(order.inputs.tranche).toBe(1);
      expect(order.reason).toMatch(/tranche 1 of 3/);
      expect(order.reason).toMatch(/Not a fill/);
      expect(STARTER_UNIVERSE).toContain(order.ticker);
    }
    const core = result.plan.orders.filter((order) => order.rule === "CORE-T1");
    const conviction = result.plan.orders.filter((order) => order.rule === "CONV-T1");
    expect(core).toHaveLength(8);
    expect(conviction).toHaveLength(4);
    expect(core.every((order) => order.shares === 12 && order.dollars === 1200)).toBe(true);
    expect(conviction.every((order) => order.shares === 37 && order.dollars === 3700)).toBe(true);
    expect(result.plan.orders.some((order) => order.ticker === "SPY" || order.ticker === "QQQ")).toBe(false);
  });

  it("keeps today's plan unless the amount changes or Rebuild is confirmed", () => {
    const today = { notedOn: TODAY, amount: 100_000, filledToday: false };
    expect(reuseDecision({ today: TODAY, amount: 100_000, rebuild: false, existing: null })).toBe("rebuild");
    expect(reuseDecision({ today: TODAY, amount: 100_000, rebuild: false, existing: today })).toBe("reuse");
    expect(reuseDecision({ today: TODAY, amount: 100_000.001, rebuild: false, existing: today })).toBe("reuse");
    expect(reuseDecision({ today: TODAY, amount: 80_000, rebuild: false, existing: today })).toBe("rebuild");
    expect(reuseDecision({ today: TODAY, amount: 100_000, rebuild: true, existing: today })).toBe("rebuild");
    const filled = { ...today, filledToday: true };
    expect(reuseDecision({ today: TODAY, amount: 100_000, rebuild: false, existing: filled })).toBe("reuse");
    expect(reuseDecision({ today: TODAY, amount: 80_000, rebuild: false, existing: filled })).toBe("confirm");
    expect(reuseDecision({ today: TODAY, amount: 80_000, rebuild: true, existing: filled })).toBe("rebuild");
    expect(reuseDecision({ today: TODAY, amount: 100_000, rebuild: true, existing: filled })).toBe("rebuild");
    expect(reuseDecision({
      today: TODAY,
      amount: 80_000,
      rebuild: false,
      existing: { notedOn: "2026-10-01", amount: 100_000, filledToday: true },
    })).toBe("rebuild");
  });

  it("rejects a pick that is not 8 core names and 3 to 5 themes", () => {
    const parsed = parsePlanPick(JSON.stringify({ core: ["AAPL"], themes: [] }));
    expect(parsed.ok).toBe(false);
  });
});
