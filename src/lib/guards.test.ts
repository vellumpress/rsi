import { describe, expect, it } from "vitest";
import { reviewManualTrade } from "./guards";

const base = {
  side: "buy" as const,
  dollars: 5_000,
  price: 50,
  sleeve: "conviction" as const,
  tranche: 1 as const,
  heldShares: 0,
  missedMilestones: 0,
  killHit: false,
  exitReason: "trim" as const,
  fromEngine: false,
  marketValue: 0,
  bookValue: 100_000,
  cash: 20_000,
  instrument: "equity" as const,
};

describe("ledger guards", () => {
  it("rejects an ETF or an unconfirmed symbol and never buys a benchmark", () => {
    const etf = reviewManualTrade({ ...base, instrument: "etf" });
    expect(etf.ok).toBe(false);
    if (!etf.ok) expect(etf.reason).toMatch(/ETF or fund/);
    const fund = reviewManualTrade({ ...base, instrument: "mutualfund" });
    expect(fund.ok).toBe(false);
    const unknown = reviewManualTrade({ ...base, instrument: "unknown" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toMatch(/EQUITY/);
  });

  it("refuses a hand-entered fear tranche and an average-down after a miss", () => {
    const fear = reviewManualTrade({ ...base, tranche: 2 });
    expect(fear.ok).toBe(false);
    if (!fear.ok) expect(fear.reason).toMatch(/execution engine/i);

    const down = reviewManualTrade({ ...base, missedMilestones: 1 });
    expect(down.ok).toBe(false);
    if (!down.ok) expect(down.reason).toMatch(/average down/i);
  });

  it("refuses a sentiment exit and a trim that would empty the position", () => {
    const mood = reviewManualTrade({ ...base, side: "sell", exitReason: "sentiment", heldShares: 100, dollars: 1_000 });
    expect(mood.ok).toBe(false);
    if (!mood.ok) expect(mood.reason).toMatch(/Sentiment/);

    const wipe = reviewManualTrade({ ...base, side: "sell", exitReason: "trim", heldShares: 10, price: 10, dollars: 100 });
    expect(wipe.ok).toBe(false);
    if (!wipe.ok) expect(wipe.reason).toMatch(/must not empty/);

    const kill = reviewManualTrade({ ...base, side: "sell", exitReason: "kill", killHit: true, heldShares: 10, price: 10, dollars: 100 });
    expect(kill.ok).toBe(true);
    if (kill.ok) expect(kill.shares).toBe(10);
  });

  it("floors a buy so the cost stays inside the cash and the 15% cap", () => {
    const fit = reviewManualTrade({ ...base, dollars: 8_000, marketValue: 14_000, cash: 20_000, price: 10 });
    expect(fit.ok).toBe(true);
    if (fit.ok) {
      expect(fit.dollars).toBeLessThanOrEqual(1_000);
      expect(14_000 + fit.dollars).toBeLessThanOrEqual(15_000.01);
    }
  });
});