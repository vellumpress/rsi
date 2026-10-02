import { describe, expect, it } from "vitest";
import type { PriceBook, Thesis, Trade } from "../types";
import { deriveDesk } from "./brief";
import { defaultState } from "./storage";
import { emptyLoop } from "./thesis";

function thesis(over: Partial<Thesis> = {}): Thesis {
  return {
    id: "soft",
    theme: "Software disbelief",
    ticker: "CRM",
    openedOn: "2026-10-02",
    version: 1,
    marketBelief: "Software is a broken sector.",
    ourBelief: "The drawdown is disbelief, not the end of the cash flows.",
    whyWrong: "The selling is broad.",
    killCondition: "A second dated milestone misses.",
    killHit: false,
    milestones: [1, 2, 3].map((n) => ({
      id: `m${n}`,
      metric: `Metric ${n}`,
      target: "Reported figure",
      byDate: `2027-0${n}-15`,
      status: "pending" as const,
      resolvedOn: null,
    })),
    valuationMetric: "EV/sales vs 10-year history",
    addBelow: "bottom quartile",
    trimAbove: "top decile",
    valuationPercentile: 40,
    bearCase: "The multiple never re-rates.",
    targetMode: "plan",
    targetDollars: null,
    probability: 55,
    benchmark: "QQQ",
    archived: false,
    log: [],
    ...emptyLoop("approved"),
    ...over,
  };
}

function prices(quotes: Record<string, { price: number; sma200: number; high52w: number }>): PriceBook {
  return {
    fetchedAt: "2026-10-02T20:00:00.000Z",
    source: "test",
    quotes: Object.fromEntries(
      Object.entries(quotes).map(([ticker, quote]) => {
        const fund = ticker === "SPY" || ticker === "QQQ" || ticker === "IGV";
        return [
          ticker,
          {
            ticker,
            ...quote,
            asOf: "2026-10-02",
            currency: "USD",
            bars: 220,
            previousClose: quote.price,
            instrumentType: fund ? "ETF" : "EQUITY",
            quoteType: fund ? "ETF" : "EQUITY",
            source: "test",
          },
        ];
      }),
    ),
  };
}

describe("daily brief", () => {
  it("schedules week-0 deployment on the start date and scales the dollars", () => {
    const state = defaultState("2026-10-02");
    state.settings.coreTickers = ["AAA", "BBB"];
    state.settings.coreSlots = 2;
    state.theses = [thesis()];
    const quoteBook = prices({
      SPY: { price: 700, sma200: 650, high52w: 710 },
      QQQ: { price: 600, sma200: 560, high52w: 610 },
      AAA: { price: 100, sma200: 90, high52w: 110 },
      BBB: { price: 80, sma200: 70, high52w: 90 },
      CRM: { price: 90, sma200: 100, high52w: 120 },
    });
    const full = deriveDesk(state, quoteBook, "2026-10-02", "2026-10-02T12:00:00.000Z");
    expect(full.brief.fridaySweep).toBe(true);
    expect(full.brief.circuitBreaker).toBe(false);
    expect(full.brief.bookValue).toBe(100_000);
    expect(full.schedule.map((row) => [row.id, row.date])).toEqual([
      ["week0", "2026-10-02"],
      ["month1", "2026-11-02"],
      ["month2", "2026-12-02"],
      ["weekly", "2026-10-02"],
      ["quarter4", "2027-10-02"],
    ]);
    const buys = full.brief.schedule.filter((action) => action.side === "buy");
    expect(buys.map((action) => [action.ticker, action.dollars, action.rule])).toEqual([
      ["AAA", 5_000, "WEEK0"],
      ["BBB", 5_000, "WEEK0"],
      ["CRM", 5_000, "WEEK0"],
    ]);
    expect(buys.some((action) => action.ticker === "SPY" || action.ticker === "QQQ")).toBe(false);

    const half = defaultState("2026-10-02");
    half.settings.capital = 50_000;
    half.settings.coreTickers = ["AAA", "BBB"];
    half.settings.coreSlots = 2;
    half.theses = [thesis()];
    const scaled = deriveDesk(half, quoteBook, "2026-10-02", "2026-10-02T12:00:00.000Z");
    expect(scaled.brief.schedule.filter((action) => action.side === "buy").map((action) => action.dollars)).toEqual([2_500, 2_500, 2_500]);
    expect(full.brief.notes[0]).toMatch(/Not financial advice/);
    expect(full.brief.notes[0]).toMatch(/Verify before trading/);
    expect(full.brief.quotes.find((quote) => quote.ticker === "CRM")).toMatchObject({ asOf: "2026-10-02", block: "ok", source: "test", role: "holding" });
    expect(full.brief.quotes.find((quote) => quote.ticker === "SPY")?.role).toBe("benchmark");
  });

  it("asks for core names and never buys a benchmark when the basket is empty", () => {
    const state = defaultState("2026-10-02");
    const derived = deriveDesk(
      state,
      prices({ SPY: { price: 700, sma200: 650, high52w: 710 }, QQQ: { price: 600, sma200: 560, high52w: 610 } }),
      "2026-10-02",
      "2026-10-02T12:00:00.000Z",
    );
    expect(derived.brief.schedule.some((action) => action.rule === "CORE" && action.side === "review")).toBe(true);
    const orders = [...derived.brief.schedule, ...derived.brief.engine].filter((action) => action.side === "buy" || action.side === "sell");
    expect(orders).toHaveLength(0);
  });

  it("never emits a buy or a sell for an ETF", () => {
    const state = defaultState("2026-10-02");
    state.settings.coreTickers = ["IGV"];
    state.settings.coreSlots = 1;
    state.theses = [thesis({ ticker: "IGV" })];
    state.trades = [
      {
        id: "t",
        date: "2026-10-02",
        ticker: "IGV",
        side: "buy",
        dollars: 5_000,
        shares: 50,
        price: 100,
        sleeve: "conviction",
        thesisId: "soft",
        tranche: 1,
        note: "",
      },
    ];
    const derived = deriveDesk(
      state,
      prices({
        SPY: { price: 700, sma200: 650, high52w: 710 },
        QQQ: { price: 600, sma200: 560, high52w: 610 },
        IGV: { price: 90, sma200: 40, high52w: 120 },
      }),
      "2026-10-02",
      "2026-10-02T12:00:00.000Z",
    );
    const orders = [...derived.brief.schedule, ...derived.brief.engine].filter((action) => action.side === "buy" || action.side === "sell");
    expect(orders).toHaveLength(0);
    expect(derived.brief.schedule.some((action) => action.rule === "FUND")).toBe(true);
    expect(derived.brief.engine.find((action) => action.ticker === "IGV")?.side).toBe("hold");
  });

  it("does not deploy before the start date", () => {
    const state = defaultState("2026-10-02");
    state.settings.startDate = "2026-11-01";
    state.theses = [thesis()];
    const derived = deriveDesk(state, null, "2026-10-02", "2026-10-02T12:00:00.000Z");
    expect(derived.brief.schedule).toHaveLength(0);
    expect(derived.schedule[0].status).toBe("upcoming");
  });

  it("freezes scheduled adds when the book is down 30% and still trims", () => {
    const state = defaultState("2026-10-02");
    state.theses = [thesis()];
    const buy: Trade = {
      id: "t",
      date: "2026-10-02",
      ticker: "CRM",
      side: "buy",
      dollars: 50_000,
      shares: 500,
      price: 100,
      sleeve: "conviction",
      thesisId: "soft",
      tranche: 1,
      note: "",
    };
    state.trades = [buy];
    const derived = deriveDesk(
      state,
      prices({
        SPY: { price: 700, sma200: 650, high52w: 710 },
        CRM: { price: 40, sma200: 30, high52w: 100 },
        QQQ: { price: 600, sma200: 560, high52w: 610 },
      }),
      "2026-10-02",
      "2026-10-02T12:00:00.000Z",
    );
    expect(derived.marks.bookValue).toBe(70_000);
    expect(derived.brief.circuitBreaker).toBe(true);
    expect(derived.brief.schedule.every((action) => action.side !== "buy")).toBe(true);
    const trim = derived.brief.engine.find((action) => action.rule === "R2");
    expect(trim?.side).toBe("sell");
    expect(trim?.dollars).toBe(9_500);
  });

  it("raises the monthly scorecard and the four-quarter meta-rule when they are due", () => {
    const state = defaultState("2025-10-02");
    state.settings.startDate = "2025-10-02";
    state.benchmarkAnchor = { spy: { date: "2025-10-02", price: 500 }, qqq: { date: "2025-10-02", price: 400 } };
    const derived = deriveDesk(
      state,
      prices({ SPY: { price: 550, sma200: 520, high52w: 560 }, QQQ: { price: 440, sma200: 400, high52w: 450 } }),
      "2026-10-02",
      "2026-10-02T12:00:00.000Z",
    );
    const rules = derived.brief.reminders.map((action) => action.rule);
    expect(rules).toContain("SCORECARD");
    expect(rules).toContain("POSTMORTEM");
    expect(rules).toContain("REBALANCE");
    expect(rules).toContain("METARULE");
    const meta = derived.brief.reminders.find((action) => action.rule === "METARULE");
    expect(meta?.reason).toMatch(/QQQ/);
  });

  it("says so when a held ticker has no price", () => {
    const state = defaultState("2026-10-02");
    state.theses = [thesis({ valuationPercentile: 50 })];
    state.trades = [
      {
        id: "t",
        date: "2026-10-02",
        ticker: "CRM",
        side: "buy",
        dollars: 5_000,
        shares: 50,
        price: 100,
        sleeve: "conviction",
        thesisId: "soft",
        tranche: 1,
        note: "",
      },
    ];
    const derived = deriveDesk(state, prices({ SPY: { price: 700, sma200: 650, high52w: 710 } }), "2026-10-02", "2026-10-02T12:00:00.000Z");
    expect(derived.marks.bookValue).toBeNull();
    expect(derived.brief.dataGaps.join(" ")).toMatch(/CRM/);
    expect(derived.brief.circuitBreakerEvaluated).toBe(false);
    expect(derived.brief.engine.some((action) => action.dollars === null && action.side === "sell")).toBe(false);
    expect(derived.brief.schedule.some((action) => action.ticker === "CRM" && action.side === "buy")).toBe(false);
    expect(derived.brief.engine.find((action) => action.ticker === "CRM")?.dollars).toBe(0);
  });

  it("does not size a buy or a sell from a stale quote, and skips a theme that has not passed the gates", () => {
    const state = defaultState("2026-10-02");
    state.theses = [thesis(), thesis({ id: "watch", ticker: "MU", theme: "Memory", stage: "watchlist" })];
    state.trades = [
      {
        id: "t",
        date: "2026-09-01",
        ticker: "CRM",
        side: "buy",
        dollars: 8_000,
        shares: 80,
        price: 100,
        sleeve: "conviction",
        thesisId: "soft",
        tranche: 1,
        note: "",
      },
    ];
    const book = prices({
      SPY: { price: 700, sma200: 650, high52w: 710 },
      CRM: { price: 200, sma200: 100, high52w: 210 },
      QQQ: { price: 600, sma200: 560, high52w: 610 },
    });
    book.quotes.CRM.asOf = "2026-09-28";
    book.quotes.SPY.asOf = "2026-09-28";
    const derived = deriveDesk(state, book, "2026-10-02", "2026-10-02T12:00:00.000Z");
    expect(derived.brief.schedule.filter((action) => action.side === "buy")).toHaveLength(0);
    expect(derived.brief.schedule.every((action) => action.rule === "DATA" || action.side !== "buy")).toBe(true);
    expect(derived.brief.engine.find((action) => action.ticker === "CRM")?.dollars).toBe(0);
    expect(derived.brief.engine.find((action) => action.ticker === "CRM")?.reason).toMatch(/Insufficient data, no action/);
    expect(derived.brief.schedule.some((action) => action.ticker === "MU")).toBe(false);
    const stamp = derived.brief.quotes.find((quote) => quote.ticker === "SPY");
    expect(stamp?.block).toBe("stale");
    expect(stamp?.ageTradingDays).toBeGreaterThan(2);
  });

  it("trims with the live rulebook fraction", () => {
    const state = defaultState("2026-10-02");
    state.rulebook = { ...state.rulebook, thresholds: { ...state.rulebook.thresholds, trimFraction: 0.25 } };
    state.theses = [thesis({ valuationPercentile: 95 })];
    state.trades = [
      {
        id: "t",
        date: "2026-09-01",
        ticker: "CRM",
        side: "buy",
        dollars: 8_000,
        shares: 160,
        price: 50,
        sleeve: "conviction",
        thesisId: "soft",
        tranche: 1,
        note: "",
      },
    ];
    const derived = deriveDesk(
      state,
      prices({ SPY: { price: 700, sma200: 650, high52w: 710 }, CRM: { price: 50, sma200: 48, high52w: 80 }, QQQ: { price: 600, sma200: 560, high52w: 610 } }),
      "2026-10-02",
      "2026-10-02T12:00:00.000Z",
    );
    const trim = derived.brief.engine.find((action) => action.rule === "R2");
    expect(trim?.dollars).toBe(2_000);
  });
});
