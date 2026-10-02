import { describe, expect, it } from "vitest";
import { averageDownBlocked, bandGate, bearGate, brierScore, calibrationTable, fullExitAllowed, scoutGate, sizeTranche1 } from "./loop";

describe("recursive loop gates", () => {
  it("accepts only a disbelieved trend with evidence", () => {
    expect(scoutGate({ trend: "", ticker: "IGV", disbelief: "low-valuation", evidence: "Cheap versus ten years." }).ok).toBe(false);
    expect(scoutGate({ trend: "Software", ticker: "IGV", disbelief: null, evidence: "Drawdown." }).ok).toBe(false);
    expect(
      scoutGate({ trend: "Software disbelief", ticker: "IGV", disbelief: "negative-sentiment", evidence: "The ETF is down while retention holds." }).ok,
    ).toBe(true);
  });

  it("archives a thesis that loses to the bear case and will not pass without a probability", () => {
    const archived = bearGate({ beatsBear: false, claims: [{ id: "b", claim: "Multiples never re-rate.", probability: 60 }], thesisProbability: 40 }, "2026-10-02");
    expect(archived.decision).toBe("archive");
    if (archived.decision === "archive") expect(archived.revisitOn).toBe("2027-01-02");

    const blank = bearGate({ beatsBear: null, claims: [{ id: "b", claim: "Multiples never re-rate.", probability: 60 }], thesisProbability: 40 }, "2026-10-02");
    expect(blank.decision).toBe("incomplete");

    const passed = bearGate({ beatsBear: true, claims: [{ id: "b", claim: "Multiples never re-rate.", probability: 30 }], thesisProbability: 55 }, "2026-10-02");
    expect(passed.decision).toBe("pass");
  });

  it("keeps a price outside the add band on the watchlist and alerts at the edge", () => {
    expect(bandGate({ price: null, addBelow: 80, trimAbove: 140, quoteOk: false }).status).toBe("unknown");
    const outside = bandGate({ price: 100, addBelow: 80, trimAbove: 140, quoteOk: true });
    expect(outside.status).toBe("outside");
    expect(outside.alert).toBe(false);
    const edge = bandGate({ price: 81, addBelow: 80, trimAbove: 140, quoteOk: true });
    expect(edge.status).toBe("outside");
    expect(edge.alert).toBe(true);
    const inside = bandGate({ price: 79, addBelow: 80, trimAbove: 140, quoteOk: true });
    expect(inside.status).toBe("inside");
  });

  it("sizes only the entry third and refuses a second entry", () => {
    const sized = sizeTranche1({
      targetDollars: 15_000,
      capDollars: 15_000,
      earmarked: 15_000,
      price: 50,
      marketValue: 0,
      bookValue: 100_000,
      alreadyDeployed: false,
    });
    expect(sized.ok).toBe(true);
    expect(sized.dollars).toBeLessThanOrEqual(5_000);
    expect(sized.dollars).toBeGreaterThan(4_900);
    const again = sizeTranche1({
      targetDollars: 15_000,
      capDollars: 15_000,
      earmarked: 10_000,
      price: 50,
      marketValue: 5_000,
      bookValue: 100_000,
      alreadyDeployed: true,
    });
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/execution engine/i);
  });

  it("scores resolved probabilities and leaves unresolved ones out of the Brier score", () => {
    expect(brierScore([{ id: "a", probability: 0.7, outcome: null }])).toBeNull();
    const score = brierScore([
      { id: "a", probability: 1, outcome: 1 },
      { id: "b", probability: 0, outcome: 1 },
    ]);
    expect(score).toBeCloseTo(0.5, 8);
    const table = calibrationTable([
      { id: "a", probability: 0.25, outcome: 1 },
      { id: "b", probability: 0.25, outcome: 0 },
    ]);
    const bucket = table[2];
    expect(bucket.count).toBe(2);
    expect(bucket.hitRate).toBeCloseTo(0.5, 8);
  });

  it("enforces the two rules that never bend at the gate", () => {
    expect(averageDownBlocked(1)).toBe(true);
    expect(averageDownBlocked(0)).toBe(false);
    expect(fullExitAllowed("sentiment")).toBe(false);
    expect(fullExitAllowed("trim")).toBe(false);
    expect(fullExitAllowed("kill")).toBe(true);
    expect(fullExitAllowed("meta-rule")).toBe(true);
  });
});
