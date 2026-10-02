import { describe, expect, it } from "vitest";
import { absorbFeedback, applyConstraints, bossContext, classifyFeedback, constraintsFromFeedback, persistFeedback } from "./boss";
import { defaultRulebook } from "./rulebook";
import { considerChange, isImmutable, maybeRollback, replayHitRate } from "./improve";
import { shrinkThesisProbability } from "./learning";
import { attributeReturns, executionSlippage, hitRateBy, type LoggedRecommendation } from "./scoring";
import { wholeBuy, wholeSell } from "./wholeShares";
import { calibrationTable } from "./loop";

const rec = (patch: Partial<LoggedRecommendation> = {}): LoggedRecommendation => ({
  id: "rec-1",
  date: "2026-10-02",
  ticker: "AAPL",
  side: "buy",
  rule: "R4",
  theme: "hardware",
  probability: 0.6,
  expectedOutcome: "The add holds the band.",
  referencePrice: 100,
  shares: 10,
  dollars: 1000,
  reason: "Fear add.",
  outcome: null,
  ...patch,
});

describe("scoring", () => {
  it("measures slippage from the recorded fill and withholds a missing fill", () => {
    expect(executionSlippage(rec(), null)).toBeNull();
    const slip = executionSlippage(rec(), {
      recommendationId: "rec-1",
      ticker: "AAPL",
      side: "buy",
      shares: 10,
      price: 102,
      date: "2026-10-03",
    });
    expect(slip).toEqual({ priceGap: 0.02, dollars: 20, days: 1 });
    const sold = executionSlippage(rec({ side: "sell" }), {
      recommendationId: "rec-1",
      ticker: "AAPL",
      side: "sell",
      shares: 4,
      price: 90,
      date: "2026-10-02",
    });
    expect(sold?.priceGap).toBeCloseTo(0.1);
    expect(sold?.dollars).toBe(40);
  });

  it("splits hit rate and attributes selection, sizing, and timing", () => {
    const rows = [rec({ outcome: 1, rule: "R4", theme: "hardware" }), rec({ id: "b", outcome: 0, rule: "R2", theme: "hardware" }), rec({ id: "c", outcome: null, rule: "R4" })];
    expect(hitRateBy(rows, "rule").find((row) => row.name === "R4")).toMatchObject({ hits: 1, resolved: 1, rate: 1 });
    const split = attributeReturns([
      { weight: 0.5, positionReturn: 0.2, benchmarkReturn: 0.1, fillReturn: 0.15, referenceReturn: 0.2 },
      { weight: 0.5, positionReturn: 0, benchmarkReturn: 0.1, fillReturn: null, referenceReturn: 0 },
    ]);
    expect(split.selection).toBeCloseTo(0);
    expect(split.sizing).toBeCloseTo(0);
    expect(split.timing).toBeNull();
  });
});

describe("learning store", () => {
  it("shrinks an overconfident thesis probability and leaves an underconfident one", () => {
    const calibration = calibrationTable([
      { id: "a", probability: 0.65, outcome: 0 },
      { id: "b", probability: 0.62, outcome: 0 },
      { id: "c", probability: 0.68, outcome: 1 },
    ]);
    const shrunk = shrinkThesisProbability(65, calibration);
    expect(shrunk).toBeLessThan(65);
    const humble = calibrationTable([{ id: "d", probability: 0.2, outcome: 1 }]);
    expect(shrinkThesisProbability(20, humble)).toBe(20);
    expect(shrinkThesisProbability(50, [])).toBe(50);
  });
});

describe("rule changes", () => {
  const book = defaultRulebook("2026-01-01");
  const base = {
    id: "c1",
    date: "2026-10-02",
    quarterKey: "2026-Q4",
    parameter: "greedAboveSma",
    next: 0.55,
    evidence: "The replay of eight fear and greed cases improved the hit rate.",
    bookValue: 100,
    peak: 100,
    sampleSize: 8,
    replayDelta: 0.03,
  };

  it("applies one change and refuses a second in the same quarter", () => {
    const first = considerChange(book, base);
    expect(first.ok).toBe(true);
    expect(first.rulebook.version).toBe("1.1");
    const second = considerChange(first.rulebook, { ...base, id: "c2", next: 0.6 });
    expect(second.ok).toBe(false);
    expect(second.rulebook.thresholds.greedAboveSma).toBe(0.55);
  });

  it("refuses immutable rails", () => {
    expect(isImmutable("positionCap")).toBe(true);
    expect(isImmutable("fourRules")).toBe(true);
    const refused = considerChange(book, { ...base, parameter: "positionCap", next: 0.25 });
    expect(refused.ok).toBe(false);
    expect(refused.rulebook.thresholds.positionCap).toBe(0.15);
    const stocks = considerChange(book, { ...base, parameter: "stocksOnly", next: 1 });
    expect(stocks.ok).toBe(false);
    expect(stocks.rulebook).toBe(book);
  });

  it("rolls back when the next quarter's evidence goes against the change", () => {
    const applied = considerChange(book, base);
    const drawdownBook = { ...applied.rulebook };
    const rolled = maybeRollback(
      drawdownBook,
      { id: "c1", quarterKey: "2026-Q4", parameter: "greedAboveSma", previous: 0.5, next: 0.55, metricAtChange: 0.2 },
      { id: "rb", date: "2027-01-02", quarterKey: "2027-Q1", metricNow: 0.4 },
    );
    expect(rolled.rolledBack).toBe(true);
    expect(rolled.rulebook.thresholds.greedAboveSma).toBe(0.5);
    expect(rolled.rulebook.changelog.at(-1)?.evidence).toMatch(/Rolled back/);
    const held = maybeRollback(
      applied.rulebook,
      { id: "c1", quarterKey: "2026-Q4", parameter: "greedAboveSma", previous: 0.5, next: 0.55, metricAtChange: 0.2 },
      { id: "rb2", date: "2027-01-02", quarterKey: "2027-Q1", metricNow: 0.2 },
    );
    expect(held.rolledBack).toBe(false);
  });

  it("scores a replay only on the cases that would have fired", () => {
    const cases = [
      { signal: 0.6, outcome: 1 as const },
      { signal: 0.6, outcome: 0 as const },
      { signal: 0.2, outcome: 0 as const },
    ];
    expect(replayHitRate(cases, 0.5).rate).toBe(0.5);
    expect(replayHitRate(cases, 0.5).fired).toBe(2);
    expect(replayHitRate(cases, 0.9).rate).toBeNull();
  });
});

describe("whole shares", () => {
  it("rounds buys down and sizes nothing without a price", () => {
    expect(wholeBuy(1000, 33.5)).toEqual({ shares: 29, dollars: 971.5, price: 33.5 });
    expect(wholeBuy(10, 33.5)).toBeNull();
    expect(wholeBuy(1000, null)).toBeNull();
    expect(wholeSell(1000, 33.5, 10.8)).toEqual({ shares: 10, dollars: 335, price: 33.5 });
  });
});

describe("the Boss", () => {
  it("persists feedback and keeps a rule request off the rulebook", () => {
    const exclusion = classifyFeedback("I don't want exposure to oil", "2026-10-02", "f1");
    expect(exclusion.tag).toBe("exclusion");
    expect(exclusion.constraint?.excludeThemes).toEqual(["oil"]);
    const stored = persistFeedback([], exclusion);
    expect(stored).toHaveLength(1);
    expect(persistFeedback(stored, exclusion)).toHaveLength(1);

    const book = defaultRulebook("2026-01-01");
    const attack = classifyFeedback("Please drop the 15% cap and buy SPY", "2026-10-02", "f2");
    expect(attack.tag).toBe("rule-change");
    expect(attack.constraint).toBeNull();
    const absorbed = absorbFeedback(book, attack);
    expect(absorbed.rulebook.thresholds).toEqual(book.thresholds);
    expect(absorbed.message).toMatch(/immutable/);
    expect(absorbed.message).toMatch(/quarter/);

    const pace = classifyFeedback("too many trades", "2026-10-02", "f3");
    const orders = applyConstraints(
      [
        { ticker: "AAPL", side: "buy", theme: "hardware" },
        { ticker: "XOM", side: "buy", theme: "oil" },
        { ticker: "SPY", side: "buy", theme: "index" },
      ],
      constraintsFromFeedback([exclusion, pace]),
      0.15,
    );
    expect(orders.positionCap).toBe(0.15);
    expect(orders.orders.map((order) => order.ticker)).toEqual(["AAPL"]);
    const looser = applyConstraints([{ ticker: "AAPL", side: "buy" }], constraintsFromFeedback([classifyFeedback("take more risk", "2026-10-02", "f4")]), 0.15);
    expect(looser.positionCap).toBe(0.15);
  });

  it("cites the engine log it was given", () => {
    const context = bossContext({
      today: "2026-10-02",
      portfolio: [],
      actions: [],
      theses: [],
      rulebookVersion: "1.0",
      pendingProposal: null,
      scorecard: null,
      calibrationNote: null,
      lessons: [],
      engineLog: { date: "2026-10-02", note: "Friday sweep. No order." },
      dataHealth: [{ ticker: "AAPL", status: "stale" }],
      feedback: [],
    });
    expect(context.citations).toContain("Engine log, Fri Oct 2");
    expect(context.prompt).toContain("Engine log, Fri Oct 2");
    expect(context.prompt).toContain("price unavailable");
  });
});
