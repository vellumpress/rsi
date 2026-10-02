import type { PriceQuote } from "../types";

const DAY = 86_400;

export function yahooChartUrl(ticker: string): string {
  const symbol = encodeURIComponent(ticker.trim().toUpperCase());
  return `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=2y&interval=1d&includeAdjustedClose=true`;
}

export function emptyQuote(ticker: string, error: string, source = "Yahoo Finance chart"): PriceQuote {
  return {
    ticker: ticker.toUpperCase(),
    price: null,
    sma200: null,
    high52w: null,
    asOf: null,
    currency: null,
    bars: 0,
    previousClose: null,
    source,
    error,
  };
}

export function nyDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

interface YahooChart {
  chart?: {
    error?: { description?: string };
    result?: YahooResult[];
  };
}

interface YahooResult {
  meta?: {
    symbol?: string;
    currency?: string;
    regularMarketPrice?: number;
    regularMarketTime?: number;
    fiftyTwoWeekHigh?: number;
  };
  timestamp?: number[];
  indicators?: {
    quote?: { high?: (number | null)[] }[];
    adjclose?: { adjclose?: (number | null)[] }[];
  };
}

/** Current price, 200-day average, and 52-week high from a Yahoo chart payload. */
export function parseYahooChart(payload: unknown, fallbackTicker: string): PriceQuote {
  const chart = (payload as YahooChart)?.chart;
  const result = chart?.result?.[0];
  if (!result) {
    return emptyQuote(fallbackTicker, chart?.error?.description || "Yahoo returned no chart for this symbol.");
  }
  const meta = result.meta ?? {};
  const adjusted = (result.indicators?.adjclose?.[0]?.adjclose ?? []).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const sma200 = adjusted.length >= 200 ? adjusted.slice(-200).reduce((sum, value) => sum + value, 0) / 200 : null;
  const last = adjusted.at(-1) ?? null;
  // Prior bar, not chartPreviousClose. On a 2-year chart that field is the start of the range.
  const previousClose = adjusted.length >= 2 ? adjusted[adjusted.length - 2] : null;
  const price = typeof meta.regularMarketPrice === "number" && Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : last;
  const high52w = typeof meta.fiftyTwoWeekHigh === "number" && Number.isFinite(meta.fiftyTwoWeekHigh) ? meta.fiftyTwoWeekHigh : trailingHigh(result);
  const asOf = typeof meta.regularMarketTime === "number" ? nyDate(meta.regularMarketTime * 1000) : null;
  if (price == null) {
    return emptyQuote(String(meta.symbol || fallbackTicker), "Yahoo returned a chart with no price.", "Yahoo Finance chart");
  }
  return {
    ticker: String(meta.symbol || fallbackTicker).toUpperCase(),
    price,
    sma200,
    high52w,
    asOf,
    currency: meta.currency ?? null,
    bars: adjusted.length,
    previousClose,
    source: "Yahoo Finance chart",
    error: sma200 == null ? "Fewer than 200 closes, so the 200-day average is withheld." : undefined,
  };
}

function trailingHigh(result: YahooResult): number | null {
  const stamps = result.timestamp ?? [];
  const highs = result.indicators?.quote?.[0]?.high ?? [];
  if (!stamps.length) return null;
  const cutoff = stamps[stamps.length - 1] - 365 * DAY;
  let high = -Infinity;
  for (let i = 0; i < stamps.length; i += 1) {
    const value = highs[i];
    if (stamps[i] >= cutoff && typeof value === "number" && value > high) high = value;
  }
  return Number.isFinite(high) ? high : null;
}
