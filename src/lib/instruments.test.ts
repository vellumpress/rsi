import { describe, expect, it } from "vitest";
import { runEngine, type EnginePosition } from "./engine";
import { buyBlockedReason, classifyInstrument, isBenchmarkTicker } from "./instruments";

describe("equities only", () => {
  it("treats benchmarks as funds and allows only EQUITY", () => {
    expect(isBenchmarkTicker("spy")).toBe(true);
    expect(classifyInstrument({ ticker: "SPY" })).toBe("etf");
    expect(classifyInstrument({ ticker: "QQQ", instrumentType: "EQUITY" })).toBe("etf");
    expect(classifyInstrument({ instrumentType: "ETF", quoteType: "ETF" })).toBe("etf");
    expect(classifyInstrument({ quoteType: "MUTUALFUND" })).toBe("mutualfund");
    expect(classifyInstrument({ instrumentType: "EQUITY", quoteType: "EQUITY" })).toBe("equity");
    expect(classifyInstrument({ instrumentType: "INDEX" })).toBe("other");
    expect(classifyInstrument({})).toBe("unknown");
    expect(buyBlockedReason("equity")).toBeNull();
    expect(buyBlockedReason("etf")).toMatch(/ETF or fund/);
    expect(buyBlockedReason("unknown")).toMatch(/EQUITY/);
  });

  it("does not recommend a buy or a sell of a fund", () => {
    const position: EnginePosition = {
      id: "p",
      ticker: "SPY",
      sleeve: "core",
      engineAdds: false,
      shares: 10,
      marketValue: 7_000,
      price: 700,
      sma200: 500,
      high52w: 710,
      valuationPercentile: 99,
      killConditionHit: true,
      milestones: [],
      lastBuyDate: "2026-10-02",
      tranche1Deployed: true,
      tranche2Deployed: true,
      tranche3Deployed: true,
      trancheDollars: 5_000,
      earmarkedCash: 0,
      lastFearAddDate: null,
      instrument: "etf",
    };
    const result = runEngine({
      bookValue: 100_000,
      peakValue: 100_000,
      dryPowder: 25_000,
      fridaySweep: true,
      today: "2026-10-09",
      positions: [position],
    });
    expect(result.actions[0].side).toBe("hold");
    expect(result.actions[0].dollars).toBe(0);
    expect(result.actions[0].reason).toMatch(/benchmarks/);
  });
});
