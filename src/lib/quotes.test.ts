import { describe, expect, it } from "vitest";
import { assessQuote, tradingDaysBetween } from "./quotes";

describe("quote safety", () => {
  const fresh = { price: 100, previousClose: 98, asOf: "2026-10-02", bars: 220 };

  it("counts only weekdays and blocks quotes older than two trading days", () => {
    expect(tradingDaysBetween("2026-10-02", "2026-10-05")).toBe(1);
    expect(assessQuote(fresh, "2026-10-02").block).toBe("ok");
    expect(assessQuote({ ...fresh, asOf: "2026-09-29" }, "2026-10-02").block).toBe("stale");
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