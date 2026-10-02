import { describe, expect, it } from "vitest";
import { runEngine, TRIM_FRACTION, type EngineBook, type EnginePosition } from "./engine";
import { defaultThresholds } from "./rulebook";

function position(over: Partial<EnginePosition> = {}): EnginePosition {
  return {
    id: "p1",
    ticker: "IGV",
    sleeve: "conviction",
    engineAdds: true,
    shares: 100,
    marketValue: 5_000,
    price: 50,
    sma200: 48,
    high52w: 60,
    valuationPercentile: 50,
    killConditionHit: false,
    milestones: [
      { status: "pending", resolvedOn: null },
      { status: "pending", resolvedOn: null },
      { status: "pending", resolvedOn: null },
    ],
    lastBuyDate: "2026-10-02",
    tranche1Deployed: true,
    tranche2Deployed: false,
    tranche3Deployed: false,
    trancheDollars: 5_000,
    earmarkedCash: 10_000,
    lastFearAddDate: null,
    ...over,
  };
}

function book(positions: EnginePosition[], over: Partial<EngineBook> = {}): EngineBook {
  return {
    bookValue: 100_000,
    peakValue: 100_000,
    dryPowder: 25_000,
    fridaySweep: true,
    today: "2026-10-09",
    positions,
    ...over,
  };
}

const fear = {
  price: 60,
  sma200: 80,
  high52w: 100,
  valuationPercentile: 10,
  marketValue: 6_000,
  shares: 100,
};

describe("execution engine", () => {
  it("exits 100% on the kill condition and ignores later rules", () => {
    const result = runEngine(
      book([
        position({
          killConditionHit: true,
          marketValue: 8_000,
          price: 200,
          shares: 40,
          sma200: 100,
          valuationPercentile: 99,
        }),
      ]),
    );
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].rule).toBe("R1");
    expect(result.actions[0].side).toBe("sell");
    expect(result.actions[0].dollars).toBe(8_000);
    expect(result.actions[0].reason).toMatch(/dry powder/i);
    expect(result.actions[0].signals.extremeGreed).toBe(true);
  });

  it("treats a second milestone miss as a kill", () => {
    const result = runEngine(
      book([
        position({
          milestones: [
            { status: "missed", resolvedOn: "2026-10-03" },
            { status: "missed", resolvedOn: "2026-10-04" },
            { status: "pending", resolvedOn: null },
          ],
        }),
      ]),
    );
    expect(result.actions[0].rule).toBe("R1");
    expect(result.actions[0].side).toBe("sell");
    expect(result.actions[0].dollars).toBe(5_000);
    expect(result.actions[0].reason).toMatch(/second milestone/i);
  });

  it("refuses to open a killed theme that has no shares", () => {
    const result = runEngine(book([position({ shares: 0, marketValue: 0, killConditionHit: true })]));
    expect(result.actions[0].rule).toBe("R1");
    expect(result.actions[0].side).toBe("freeze");
    expect(result.actions[0].dollars).toBe(0);
  });

  it("trims the v1.0 fraction (20%) on price greed and on a top-decile valuation", () => {
    const byPrice = runEngine(
      book([position({ price: 100, sma200: 66, marketValue: 8_000, shares: 80, valuationPercentile: 40 })]),
    );
    expect(byPrice.actions[0].rule).toBe("R2");
    expect(byPrice.actions[0].dollars).toBe(8_000 * TRIM_FRACTION);
    expect(byPrice.actions[0].signals.greedPrice).toBe(true);
    expect(byPrice.actions[0].reason).toMatch(/20–25%/);

    const byValue = runEngine(
      book([position({ price: 50, sma200: 48, valuationPercentile: 90, marketValue: 8_000, shares: 160 })]),
    );
    expect(byValue.actions[0].rule).toBe("R2");
    expect(byValue.actions[0].dollars).toBe(8_000 * TRIM_FRACTION);
    expect(byValue.actions[0].signals.greedValuation).toBe(true);

    const notYet = runEngine(book([position({ price: 149, sma200: 100, valuationPercentile: 89, marketValue: 8_000 })]));
    expect(notYet.actions[0].rule).toBe("HOLD");
  });

  it("uses a later rulebook trim fraction instead of the v1.0 default", () => {
    const raised = runEngine(
      book([position({ price: 50, sma200: 48, valuationPercentile: 90, marketValue: 8_000, shares: 160 })], {
        rules: { ...defaultThresholds(), trimFraction: 0.25 },
      }),
    );
    expect(raised.actions[0].rule).toBe("R2");
    expect(raised.actions[0].dollars).toBe(2_000);
    expect(raised.actions[0].shares).toBeLessThan(160);
  });

  it("trims back to 15% when the position is above 20% of book", () => {
    const heavy = runEngine(
      book([position({ marketValue: 25_000, price: 50, shares: 500, sma200: 48, valuationPercentile: 40 })]),
    );
    expect(heavy.actions[0].rule).toBe("R2");
    expect(heavy.actions[0].dollars).toBe(10_000);
    expect(heavy.actions[0].reason).toMatch(/15%/);

    const exact = runEngine(
      book([position({ marketValue: 20_000, price: 50, shares: 400, sma200: 48, valuationPercentile: 40 })]),
    );
    expect(exact.actions[0].rule).toBe("HOLD");

    const greedyAndHeavy = runEngine(
      book([position({ marketValue: 25_000, price: 100, shares: 250, sma200: 60, valuationPercentile: 95 })]),
    );
    expect(greedyAndHeavy.actions[0].dollars).toBe(10_000);
    expect(greedyAndHeavy.actions[0].reason).toMatch(/overweight/i);
  });

  it("does not size a trim when the price is missing", () => {
    const result = runEngine(
      book([position({ price: null, sma200: null, high52w: null, marketValue: null, valuationPercentile: 95 })]),
    );
    expect(result.actions[0].rule).toBe("HOLD");
    expect(result.actions[0].side).toBe("hold");
    expect(result.actions[0].dollars).toBe(0);
    expect(result.actions[0].shares).toBeNull();
    expect(result.actions[0].reason).toMatch(/Insufficient data, no action/);
  });

  it("refuses a sized order when the quote is stale, invalid, or missing, including a kill", () => {
    for (const dataBlock of ["stale", "invalid", "missing"] as const) {
      const killed = runEngine(book([position({ killConditionHit: true, dataBlock, marketValue: 5_000 })]));
      expect(killed.actions[0].rule).toBe("R1");
      expect(killed.actions[0].side).toBe("hold");
      expect(killed.actions[0].dollars).toBe(0);
      expect(killed.actions[0].reason).toMatch(/Insufficient data, no action/);
    }
    const greedy = runEngine(book([position({ price: 200, sma200: 100, dataBlock: "stale", marketValue: 8_000, shares: 40 })]));
    expect(greedy.actions[0].dollars).toBe(0);
    expect(greedy.actions[0].side).toBe("hold");
  });

  it("withholds moving-average signals on a short history but still sizes a sane kill", () => {
    const fearful = runEngine(book([position({ ...fear, dataBlock: "short" })]));
    expect(fearful.actions[0].rule).toBe("HOLD");
    expect(fearful.actions[0].signals.extremeFear).toBe(false);

    const killed = runEngine(book([position({ killConditionHit: true, dataBlock: "short", price: 50, shares: 100, marketValue: 5_000 })]));
    expect(killed.actions[0].rule).toBe("R1");
    expect(killed.actions[0].side).toBe("sell");
    expect(killed.actions[0].dollars).toBe(5_000);
  });

  it("freezes adds on the first milestone miss and does not average down", () => {
    const result = runEngine(
      book([
        position({
          ...fear,
          milestones: [
            { status: "missed", resolvedOn: "2026-10-08" },
            { status: "pending", resolvedOn: null },
            { status: "pending", resolvedOn: null },
          ],
        }),
      ]),
    );
    expect(result.actions[0].rule).toBe("R3");
    expect(result.actions[0].side).toBe("freeze");
    expect(result.actions[0].dollars).toBe(0);
    expect(result.actions[0].reason).toMatch(/second miss/i);
  });

  it("buys the fear tranche only when all three fear signals and intact milestones line up", () => {
    const hit = runEngine(book([position(fear)]));
    expect(hit.actions[0].rule).toBe("R4");
    expect(hit.actions[0].side).toBe("buy");
    expect(hit.actions[0].dollars).toBe(5_000);
    expect(hit.actions[0].fromEarmarked).toBe(5_000);
    expect(hit.actions[0].fromDry).toBe(0);

    const notBelowAverage = runEngine(book([position({ ...fear, sma200: 50 })]));
    expect(notBelowAverage.actions[0].rule).toBe("HOLD");

    const notDeepEnough = runEngine(book([position({ ...fear, price: 71, marketValue: 7_100 })]));
    expect(notDeepEnough.actions[0].rule).toBe("HOLD");

    const notCheap = runEngine(book([position({ ...fear, valuationPercentile: 26 })]));
    expect(notCheap.actions[0].rule).toBe("HOLD");

    const noValuation = runEngine(book([position({ ...fear, valuationPercentile: null })]));
    expect(noValuation.actions[0].rule).toBe("HOLD");
    expect(noValuation.actions[0].reason).toMatch(/percentile/i);
  });

  it("funds tranche 2 from earmarked cash, then dry powder", () => {
    const result = runEngine(book([position({ ...fear, earmarkedCash: 2_000, trancheDollars: 5_000 })]));
    expect(result.actions[0].dollars).toBe(5_000);
    expect(result.actions[0].fromEarmarked).toBe(2_000);
    expect(result.actions[0].fromDry).toBe(3_000);
  });

  it("does not add from cash on fear until both later tranches are done", () => {
    const early = runEngine(book([position({ ...fear, tranche2Deployed: true, tranche3Deployed: false })]));
    expect(early.actions[0].rule).toBe("HOLD");
    expect(early.actions[0].side).toBe("hold");
    expect(early.actions[0].dollars).toBe(0);
  });

  it("adds from cash on a later fear signal only after both tranches, and only on Friday", () => {
    const friday = runEngine(
      book(
        [position({ ...fear, tranche2Deployed: true, tranche3Deployed: true, earmarkedCash: 0, lastFearAddDate: null })],
        { dryPowder: 9_000 },
      ),
    );
    expect(friday.actions[0].rule).toBe("R4");
    expect(friday.actions[0].fromEarmarked).toBe(0);
    expect(friday.actions[0].fromDry).toBe(5_000);

    const weekday = runEngine(
      book([position({ ...fear, tranche2Deployed: true, tranche3Deployed: true })], { fridaySweep: false, today: "2026-10-08" }),
    );
    expect(weekday.actions[0].rule).toBe("HOLD");
    expect(weekday.actions[0].reason).toMatch(/Friday/i);

    const recent = runEngine(
      book(
        [position({ ...fear, tranche2Deployed: true, tranche3Deployed: true, lastFearAddDate: "2026-10-06" })],
        { today: "2026-10-09" },
      ),
    );
    expect(recent.actions[0].rule).toBe("HOLD");
    expect(recent.actions[0].reason).toMatch(/7 days/i);
  });

  it("caps a fear add at 15% of book and skips it when cash is gone", () => {
    const capped = runEngine(book([position({ ...fear, marketValue: 14_000, trancheDollars: 5_000, earmarkedCash: 8_000 })]));
    expect(capped.actions[0].rule).toBe("R4");
    expect(capped.actions[0].dollars).toBe(1_000);

    const empty = runEngine(book([position({ ...fear, earmarkedCash: 0 })], { dryPowder: 0 }));
    expect(empty.actions[0].side).toBe("hold");
    expect(empty.actions[0].dollars).toBe(0);
    expect(empty.actions[0].reason).toMatch(/do not have funds/i);
  });

  it("does not let two fear adds spend the same dry powder twice", () => {
    const first = position({ ...fear, id: "a", ticker: "AAA", earmarkedCash: 0, trancheDollars: 4_000, marketValue: 4_000 });
    const second = position({ ...fear, id: "b", ticker: "BBB", earmarkedCash: 0, trancheDollars: 4_000, marketValue: 4_000 });
    const result = runEngine(book([first, second], { dryPowder: 5_000 }));
    expect(result.actions.map((action) => action.dollars)).toEqual([4_000, 1_000]);
    expect(result.actions.reduce((sum, action) => sum + action.fromDry, 0)).toBe(5_000);
  });

  it("buys tranche 3 only after a milestone is confirmed since the last buy", () => {
    const confirmed = runEngine(
      book([
        position({
          lastBuyDate: "2026-10-02",
          milestones: [
            { status: "hit", resolvedOn: "2026-10-08", reported: true },
            { status: "pending", resolvedOn: null },
            { status: "pending", resolvedOn: null },
          ],
        }),
      ]),
    );
    expect(confirmed.actions[0].rule).toBe("R5");
    expect(confirmed.actions[0].dollars).toBe(5_000);
    expect(confirmed.actions[0].reason).toMatch(/reported numbers/i);

    const sameDay = runEngine(
      book([
        position({
          lastBuyDate: "2026-10-02",
          milestones: [
            { status: "hit", resolvedOn: "2026-10-02", reported: true },
            { status: "pending", resolvedOn: null },
            { status: "pending", resolvedOn: null },
          ],
        }),
      ]),
    );
    expect(sameDay.actions[0].rule).toBe("HOLD");

    const already = runEngine(
      book([
        position({
          tranche3Deployed: true,
          milestones: [
            { status: "hit", resolvedOn: "2026-10-08", reported: true },
            { status: "pending", resolvedOn: null },
            { status: "pending", resolvedOn: null },
          ],
        }),
      ]),
    );
    expect(already.actions[0].rule).toBe("HOLD");
  });

  it("lets fear win over confirmation on the same day", () => {
    const result = runEngine(
      book([
        position({
          ...fear,
          milestones: [
            { status: "hit", resolvedOn: "2026-10-08", reported: true },
            { status: "pending", resolvedOn: null },
            { status: "pending", resolvedOn: null },
          ],
        }),
      ]),
    );
    expect(result.actions[0].rule).toBe("R4");
  });

  it("freezes every add at a 30% drawdown and still runs exits and trims", () => {
    const broken = { bookValue: 70_000, peakValue: 100_000 };
    const fearFrozen = runEngine(book([position(fear)], broken));
    expect(fearFrozen.circuitBreaker).toBe(true);
    expect(fearFrozen.drawdown).toBeCloseTo(0.3, 8);
    expect(fearFrozen.actions[0].rule).toBe("CB");
    expect(fearFrozen.actions[0].side).toBe("freeze");

    const stillClear = runEngine(book([position(fear)], { bookValue: 70_001, peakValue: 100_000 }));
    expect(stillClear.circuitBreaker).toBe(false);
    expect(stillClear.actions[0].rule).toBe("R4");

    const killed = runEngine(
      book([position({ ...fear, killConditionHit: true, marketValue: 4_000, price: 40, shares: 100 })], broken),
    );
    expect(killed.circuitBreaker).toBe(true);
    expect(killed.actions[0].rule).toBe("R1");
    expect(killed.actions[0].dollars).toBe(4_000);

    const trimmed = runEngine(
      book([position({ marketValue: 20_000, price: 180, sma200: 100, valuationPercentile: 40 })], broken),
    );
    expect(trimmed.actions[0].rule).toBe("R2");
    expect(trimmed.actions[0].side).toBe("sell");

    const confirmed = runEngine(
      book(
        [
          position({
            milestones: [
              { status: "hit", resolvedOn: "2026-10-08", reported: true },
              { status: "pending", resolvedOn: null },
              { status: "pending", resolvedOn: null },
            ],
          }),
        ],
        broken,
      ),
    );
    expect(confirmed.actions[0].rule).toBe("CB");
  });

  it("does not invent a circuit breaker when the book cannot be marked", () => {
    const result = runEngine(
      book([position({ price: 160, sma200: 100, marketValue: 8_000, shares: 50 })], { bookValue: null, peakValue: null }),
    );
    expect(result.circuitBreaker).toBe(false);
    expect(result.circuitBreakerEvaluated).toBe(false);
    expect(result.notes.join(" ")).toMatch(/not evaluated/i);
    expect(result.actions[0].rule).toBe("R2");
    expect(result.actions[0].dollars).toBe(8_000 * TRIM_FRACTION);
  });

  it("holds and logs when nothing fires", () => {
    const result = runEngine(book([position()]));
    expect(result.actions[0].rule).toBe("HOLD");
    expect(result.actions[0].side).toBe("hold");
    expect(result.actions[0].reason).toMatch(/Hold/);
  });
});
