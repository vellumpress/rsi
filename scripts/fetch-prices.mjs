import { readFile, writeFile } from "node:fs/promises";

const DAY = 86_400;
const REQUIRED = ["SPY", "QQQ"];

function nyDate(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function emptyQuote(ticker, error) {
  return {
    ticker,
    price: null,
    sma200: null,
    high52w: null,
    asOf: null,
    currency: null,
    bars: 0,
    previousClose: null,
    instrumentType: null,
    quoteType: null,
    source: "Yahoo Finance chart",
    error,
  };
}

function trailingHigh(result) {
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

function parseYahooChart(payload, fallbackTicker) {
  const result = payload?.chart?.result?.[0];
  if (!result) {
    return emptyQuote(fallbackTicker, payload?.chart?.error?.description || "Yahoo returned no chart for this symbol.");
  }
  const meta = result.meta ?? {};
  const adjusted = (result.indicators?.adjclose?.[0]?.adjclose ?? []).filter((value) => typeof value === "number" && Number.isFinite(value));
  const sma200 = adjusted.length >= 200 ? adjusted.slice(-200).reduce((sum, value) => sum + value, 0) / 200 : null;
  const last = adjusted.at(-1) ?? null;
  const previousClose = adjusted.length >= 2 ? adjusted[adjusted.length - 2] : null;
  const price = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : last;
  const high52w = typeof meta.fiftyTwoWeekHigh === "number" ? meta.fiftyTwoWeekHigh : trailingHigh(result);
  if (price == null) return emptyQuote(String(meta.symbol || fallbackTicker), "Yahoo returned a chart with no price.");
  return {
    ticker: String(meta.symbol || fallbackTicker).toUpperCase(),
    price,
    sma200,
    high52w,
    asOf: typeof meta.regularMarketTime === "number" ? nyDate(meta.regularMarketTime * 1000) : null,
    currency: meta.currency ?? null,
    bars: adjusted.length,
    previousClose,
    instrumentType: typeof meta.instrumentType === "string" ? meta.instrumentType : null,
    quoteType: typeof meta.quoteType === "string" ? meta.quoteType : null,
    source: "Yahoo Finance chart",
    ...(sma200 == null ? { error: "Fewer than 200 closes, so the 200-day average is withheld." } : {}),
  };
}

async function fetchTicker(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=2y&interval=1d&includeAdjustedClose=true`;
  const response = await fetch(url, { headers: { "user-agent": "rsi/1.0 (snapshot)" } });
  if (!response.ok) return emptyQuote(ticker, `Yahoo responded ${response.status}.`);
  return parseYahooChart(await response.json(), ticker);
}

const watch = JSON.parse(await readFile(new URL("../config/watchlist.json", import.meta.url), "utf8"));
const tickers = [...new Set([...REQUIRED, ...(watch.tickers ?? [])].map((ticker) => String(ticker).trim().toUpperCase()).filter(Boolean))];
const quotes = {};
for (const ticker of tickers) {
  try {
    quotes[ticker] = await fetchTicker(ticker);
    console.log(`${ticker} ${quotes[ticker].price ?? "missing"}`);
  } catch (error) {
    quotes[ticker] = emptyQuote(ticker, error instanceof Error ? error.message : "Fetch failed.");
    console.error(`${ticker} failed: ${quotes[ticker].error}`);
  }
}

const book = {
  fetchedAt: new Date().toISOString(),
  source: "Yahoo Finance chart API (query1.finance.yahoo.com/v8/finance/chart). No API key.",
  quotes,
};
await writeFile(new URL("../public/prices.json", import.meta.url), `${JSON.stringify(book, null, 2)}\n`);
const priced = Object.values(quotes).filter((quote) => quote.price != null).length;
if (priced === 0) {
  console.error("Every symbol failed. The snapshot was written with errors and no prices.");
  process.exit(1);
}
console.log(`Wrote ${priced}/${tickers.length} prices.`);
