import { describe, expect, it } from "vitest";
import { assessQuote, tradingDaysBetween } from "./quotes";

describe("quote safety", () => {
  const fresh = { price: 100, previousClose: 98, asOf: "2026-10-02", bars: 220 };

  it("counts only weekdays and blocks quotes older than two trading days", () => {
    expect(tradingDaysBetween("2026-10-02", "2026-10-05")).toBe(1);
    expect(assessQuote(fresh, "2026-10-02").block).toBe("ok");
    expect(assessQuote({ ...fresh, asOf: "2026-09-29" }, "2026-10-02").block).toBe("stale");
  });

  it("does not count a NYSE holiday as a missed session", () => {
    expect(tradingDaysBetween("2026-11-25", "2026-11-27")).toBe(1);
    expect(tradingDaysBetween("2026-12-23", "2026-12-28")).toBe(2);
    expect(assessQuote({ ...fresh, asOf: "2026-12-23" }, "2026-12-28").block).toBe("ok");
    expect(assessQuote({ ...fresh, asOf: "2026-12-22" }, "2026-12-28").block).toBe("stale");
  });

  it("rejects a missing, non-positive, or jumped price and a short history", () => {
    expect(assessQuote(undefined, "2026-10-02").block).toBe("missing");
    expect(assessQuote({ ...fresh, price: 0 }, "2026-10-02").block).toBe("invalid");
    expect(assessQuote({ ...fresh, price: -3 }, "2026-10-02").block).toBe("invalid");
    expect(assessQuote({ ...fresh, price: 150, previousClose: 100 }, "2026-10-02").block).toBe("invalid");
    expect(assessQuote({ ...fresh, bars: 120 }, "2026-10-02").block).toBe("short");
    expect(assessQuote({ ...fresh, price: null }, "2026-10-02").message).toMatch(/Insufficient data, no action/);
  });
});