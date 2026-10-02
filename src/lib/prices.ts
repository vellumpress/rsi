import type { PriceBook, PriceQuote } from "../types";
import { emptyQuote, parseYahooChart, yahooChartUrl } from "./yahoo";

export function normalizeBook(value: unknown): PriceBook {
  const input = (value ?? {}) as Partial<PriceBook> & { quotes?: Record<string, Partial<PriceQuote>> };
  const quotes: Record<string, PriceQuote> = {};
  for (const [key, quote] of Object.entries(input.quotes ?? {})) {
    const ticker = String(quote?.ticker || key).toUpperCase();
    quotes[ticker] = {
      ticker,
      price: typeof quote?.price === "number" ? quote.price : null,
      sma200: typeof quote?.sma200 === "number" ? quote.sma200 : null,
      high52w: typeof quote?.high52w === "number" ? quote.high52w : null,
      asOf: typeof quote?.asOf === "string" ? quote.asOf : null,
      currency: typeof quote?.currency === "string" ? quote.currency : null,
      bars: typeof quote?.bars === "number" ? quote.bars : 0,
      previousClose: typeof quote?.previousClose === "number" ? quote.previousClose : null,
      source: typeof quote?.source === "string" ? quote.source : input.source || "snapshot",
      error: typeof quote?.error === "string" ? quote.error : undefined,
    };
  }
  return {
    fetchedAt: typeof input.fetchedAt === "string" ? input.fetchedAt : null,
    source: typeof input.source === "string" ? input.source : "snapshot",
    quotes,
  };
}

const PUBLISHED_SNAPSHOT = "https://raw.githubusercontent.com/vellumpress/rsi/main/public/prices.json";

async function readBook(url: string): Promise<PriceBook | null> {
  try {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) return null;
    return normalizeBook(await response.json());
  } catch {
    return null;
  }
}

function newerBook(left: PriceBook | null, right: PriceBook | null): PriceBook | null {
  if (!left) return right;
  if (!right) return left;
  return (left.fetchedAt ?? "") >= (right.fetchedAt ?? "") ? left : right;
}

export async function loadPublishedSnapshot(): Promise<PriceBook | null> {
  return readBook(PUBLISHED_SNAPSHOT);
}

export async function loadSnapshot(): Promise<PriceBook> {
  const [local, remote] = await Promise.all([readBook(`${import.meta.env.BASE_URL}prices.json`), loadPublishedSnapshot()]);
  const book = newerBook(local, remote);
  if (!book) throw new Error("The price snapshot could not be loaded.");
  return book;
}

export async function fetchLiveQuotes(tickers: string[]): Promise<{ book: PriceBook; blocked: boolean }> {
  const unique = [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))];
  const quotes: Record<string, PriceQuote> = {};
  let blocked = false;
  await Promise.all(
    unique.map(async (ticker) => {
      try {
        const response = await fetch(yahooChartUrl(ticker));
        if (!response.ok) throw new Error(`Yahoo responded ${response.status} for ${ticker}.`);
        quotes[ticker] = parseYahooChart(await response.json(), ticker);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Live refresh failed.";
        if (/failed to fetch|networkerror|load failed|cors/i.test(message)) blocked = true;
        quotes[ticker] = emptyQuote(ticker, message, "Yahoo Finance chart (browser)");
      }
    }),
  );
  return {
    blocked,
    book: {
      fetchedAt: new Date().toISOString(),
      source: "Yahoo Finance chart (browser)",
      quotes,
    },
  };
}

export function mergeBooks(base: PriceBook | null, live: PriceBook): PriceBook {
  const quotes = { ...(base?.quotes ?? {}) };
  for (const [ticker, quote] of Object.entries(live.quotes)) {
    if (quote.price != null) quotes[ticker] = quote;
  }
  return {
    fetchedAt: live.fetchedAt,
    source: Object.values(live.quotes).some((quote) => quote.price != null) ? live.source : base?.source || live.source,
    quotes,
  };
}

export function describeSnapshot(book: PriceBook | null): string {
  if (!book) return "No market snapshot is loaded.";
  const quotes = Object.values(book.quotes);
  const priced = quotes.filter((quote) => quote.price != null).length;
  const when = book.fetchedAt ? new Date(book.fetchedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "an unknown time";
  return `${priced} of ${quotes.length || 0} symbols priced · ${when} · ${book.source}`;
}
