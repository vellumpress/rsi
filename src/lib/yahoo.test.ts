import { describe, expect, it } from "vitest";
import { parseYahooChart } from "./yahoo";

describe("Yahoo chart parser", () => {
  it("reads price, a 200-day average, and the 52-week high", () => {
    const adjusted = Array.from({ length: 220 }, (_, index) => index + 1);
    const payload = {
      chart: {
        result: [
          {
            meta: {
              symbol: "spy",
              currency: "USD",
              regularMarketPrice: 250,
              regularMarketTime: 1_790_961_508,
              fiftyTwoWeekHigh: 260,
            },
            timestamp: adjusted.map((_, index) => 1_700_000_000 + index * 86_400),
            indicators: {
              quote: [{ high: adjusted.map((value) => value + 1) }],
              adjclose: [{ adjclose: adjusted }],
            },
          },
        ],
      },
    };
    const quote = parseYahooChart(payload, "SPY");
    expect(quote.ticker).toBe("SPY");
    expect(quote.price).toBe(250);
    expect(quote.high52w).toBe(260);
    expect(quote.sma200).toBeCloseTo(adjusted.slice(-200).reduce((sum, value) => sum + value, 0) / 200, 8);
    expect(quote.asOf).toBe("2026-10-02");
    expect(quote.previousClose).toBe(219);
    expect(quote.error).toBeUndefined();
  });

  it("does not invent a price when the payload is empty", () => {
    const quote = parseYahooChart({ chart: { error: { description: "No data found" } } }, "NOPE");
    expect(quote.price).toBeNull();
    expect(quote.sma200).toBeNull();
    expect(quote.high52w).toBeNull();
    expect(quote.error).toMatch(/No data found/);
  });
});
