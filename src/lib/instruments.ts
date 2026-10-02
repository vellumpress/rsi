/**
 * RSI recommends only individual common stocks.
 * SPY and QQQ are fetched for the scorecard and the four-quarter test. They are never a buy or a sell.
 * Any other fund is rejected once Yahoo chart meta says ETF or MUTUALFUND. Only EQUITY may be bought.
 */

export type InstrumentClass = "equity" | "etf" | "mutualfund" | "other" | "unknown";

const BENCHMARKS = new Set(["SPY", "QQQ"]);

export function isBenchmarkTicker(ticker: string): boolean {
  return BENCHMARKS.has(ticker.trim().toUpperCase());
}

export function classifyInstrument(input: {
  ticker?: string;
  instrumentType?: string | null;
  quoteType?: string | null;
}): InstrumentClass {
  const ticker = input.ticker?.trim().toUpperCase() ?? "";
  if (isBenchmarkTicker(ticker)) return "etf";
  const blob = `${input.instrumentType ?? ""} ${input.quoteType ?? ""}`.toUpperCase();
  if (blob.includes("MUTUALFUND") || blob.includes("MUTUAL FUND")) return "mutualfund";
  if (blob.includes("ETF")) return "etf";
  if (/\bEQUITY\b/.test(blob)) return "equity";
  if (blob.trim()) return "other";
  return "unknown";
}

/** Null when a buy is allowed. Otherwise the sentence to show instead of an order. */
export function buyBlockedReason(kind: InstrumentClass): string | null {
  if (kind === "equity") return null;
  if (kind === "etf" || kind === "mutualfund") {
    return "RSI recommends only individual stocks. This symbol is an ETF or fund, so no buy is sized. SPY and QQQ are benchmarks only.";
  }
  if (kind === "unknown") {
    return "The snapshot has not confirmed this symbol is an individual equity. No buy until Yahoo chart meta says EQUITY.";
  }
  return "Only an individual equity can be bought. This symbol is not EQUITY.";
}

export function fundHoldReason(kind: InstrumentClass, ticker: string): string {
  if (kind === "etf" || kind === "mutualfund") {
    return `${ticker} is an ETF or fund. RSI does not recommend a buy or a sell. SPY and QQQ stay benchmarks. Signals are not taken from a fund.`;
  }
  if (kind === "unknown") {
    return `${ticker} is not confirmed as an individual equity. No buy or sell is sized.`;
  }
  return `${ticker} is not an individual equity. No buy or sell is sized.`;
}
