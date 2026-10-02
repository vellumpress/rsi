import { describe, expect, it } from "vitest";
import type { DeskState, Thesis, Trade } from "../types";
import { cashBuckets, totalCash } from "./ledger";
import { defaultState } from "./storage";
import { emptyLoop } from "./thesis";

function thesis(id: string, over: Partial<Thesis> = {}): Thesis {
  return {
    id,
    theme: id,
    ticker: id.toUpperCase(),
    openedOn: "2026-10-02",
    version: 1,
    marketBelief: "",
    ourBelief: "",
    whyWrong: "",
    killCondition: "",
    killHit: false,
    milestones: [1, 2, 3].map((n) => ({
      id: `${id}-m${n}`,
      metric: "",
      target: "",
      byDate: "2027-01-02",
      status: "pending" as const,
      resolvedOn: null,
    })),
    valuationMetric: "",
    addBelow: "",
    trimAbove: "",
    valuationPercentile: null,
    bearCase: "",
    targetMode: "plan",
    targetDollars: null,
    probability: null,
    benchmark: "QQQ",
    archived: false,
    log: [],
    ...emptyLoop("approved"),
    ...over,
  };
}

function trade(over: Partial<Trade> & Pick<Trade, "id" | "side" | "dollars">): Trade {
  return {
    date: "2026-10-02",
    ticker: "IGV",
    shares: over.dollars / 10,
    price: 10,
    sleeve: "conviction",
    note: "",
    ...over,
  };
}

function desk(over: Partial<DeskState> = {}): DeskState {
  return { ...defaultState("2026-10-02"), ...over };
}

describe("cash buckets", () => {
  it("parks an undeployed $100,000 book in the three sleeves", () => {
    const buckets = cashBuckets(desk().settings, [], []);
    expect(buckets.totalCash).toBe(100_000);
    expect(buckets.coreReserve).toBe(30_000);
    expect(buckets.unassignedConviction).toBe(45_000);
    expect(buckets.earmarkedTotal).toBe(0);
    expect(buckets.dryPowder).toBe(25_000);
    expect(buckets.coreReserve + buckets.earmarkedTotal + buckets.unassignedConviction + buckets.dryPowder).toBe(100_000);
  });

  it("earmarks unspent thirds and sends sale proceeds to dry powder", () => {
    const themes = [thesis("igv")];
    const settings = desk().settings;
    const opened = cashBuckets(settings, themes, []);
    expect(opened.earmarkedTotal).toBe(15_000);
    expect(opened.unassignedConviction).toBe(30_000);
    expect(opened.dryPowder).toBe(25_000);

    const afterEntry = [
      trade({ id: "c", side: "buy", dollars: 10_000, ticker: "SPY", sleeve: "core", tranche: 1 }),
      trade({ id: "t", side: "buy", dollars: 5_000, ticker: "IGV", sleeve: "conviction", thesisId: "igv", tranche: 1 }),
    ];
    const mid = cashBuckets(settings, themes, afterEntry);
    expect(totalCash(100_000, afterEntry)).toBe(85_000);
    expect(mid.coreReserve).toBe(20_000);
    expect(mid.earmarkedTotal).toBe(10_000);
    expect(mid.unassignedConviction).toBe(30_000);
    expect(mid.dryPowder).toBe(25_000);

    const afterTrim = [
      ...afterEntry,
      trade({ id: "s", side: "sell", dollars: 2_000, ticker: "IGV", sleeve: "conviction", thesisId: "igv", shares: 100, price: 20 }),
    ];
    const trimmed = cashBuckets(settings, themes, afterTrim);
    expect(trimmed.dryPowder).toBe(27_000);
    expect(trimmed.earmarkedTotal).toBe(10_000);
    expect(trimmed.coreReserve + trimmed.earmarkedTotal + trimmed.unassignedConviction + trimmed.dryPowder).toBe(trimmed.totalCash);
  });

  it("releases an archived theme's unused thirds back into the conviction sleeve", () => {
    const settings = desk().settings;
    const live = cashBuckets(settings, [thesis("igv", { archived: true })], [
      trade({ id: "t", side: "buy", dollars: 5_000, thesisId: "igv", tranche: 1 }),
    ]);
    expect(live.earmarkedTotal).toBe(0);
    expect(live.unassignedConviction).toBe(40_000);
    expect(live.dryPowder).toBe(25_000);
  });
});
