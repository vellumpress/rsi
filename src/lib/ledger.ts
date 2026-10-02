import type { PriceBook, Settings, Thesis, Trade } from "../types";
import { allocate, themeTarget } from "./allocation";
import { cents } from "./money";

const SHARE_EPS = 1e-8;

export interface PositionLot {
  id: string;
  ticker: string;
  sleeve: "core" | "conviction" | "other";
  thesisId?: string;
  shares: number;
  costBasis: number;
  lastBuyDate: string | null;
  tranche1: boolean;
  tranche2: boolean;
  tranche3: boolean;
  lastFearAddDate: string | null;
}

export interface CashBuckets {
  totalCash: number;
  coreReserve: number;
  earmarked: { thesisId: string; ticker: string; dollars: number }[];
  earmarkedTotal: number;
  unassignedConviction: number;
  dryPowder: number;
  overAllocated: boolean;
}

export interface MarkedPosition extends PositionLot {
  price: number | null;
  sma200: number | null;
  high52w: number | null;
  quoteAsOf: string | null;
  marketValue: number | null;
  weight: number | null;
  avgCost: number | null;
}

export interface MarkedBook {
  cash: number;
  bookValue: number | null;
  complete: boolean;
  gaps: string[];
  positions: MarkedPosition[];
}

export function totalCash(capital: number, trades: Trade[]): number {
  return trades.reduce((cash, trade) => cash + (trade.side === "sell" ? trade.dollars : -trade.dollars), capital);
}

export function replayTrades(trades: Trade[], coreTicker: string): PositionLot[] {
  const ordered = [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const lots = new Map<string, PositionLot>();

  const ensure = (key: string, seed: Omit<PositionLot, "shares" | "costBasis" | "lastBuyDate" | "tranche1" | "tranche2" | "tranche3" | "lastFearAddDate">) => {
    let lot = lots.get(key);
    if (!lot) {
      lot = {
        ...seed,
        shares: 0,
        costBasis: 0,
        lastBuyDate: null,
        tranche1: false,
        tranche2: false,
        tranche3: false,
        lastFearAddDate: null,
      };
      lots.set(key, lot);
    }
    return lot;
  };

  for (const trade of ordered) {
    const key = trade.sleeve === "core" ? "core" : trade.thesisId ? `thesis:${trade.thesisId}` : `other:${trade.ticker}`;
    const lot = ensure(key, {
      id: key,
      ticker: trade.sleeve === "core" ? trade.ticker || coreTicker : trade.ticker,
      sleeve: trade.sleeve === "core" ? "core" : trade.thesisId ? "conviction" : "other",
      thesisId: trade.thesisId,
    });
    if (trade.sleeve === "core" && trade.ticker) lot.ticker = trade.ticker;

    if (trade.side === "buy") {
      lot.shares += trade.shares;
      lot.costBasis += trade.dollars;
      if (!lot.lastBuyDate || trade.date > lot.lastBuyDate) lot.lastBuyDate = trade.date;
      if (trade.tranche === 1) lot.tranche1 = true;
      if (trade.tranche === 2) lot.tranche2 = true;
      if (trade.tranche === 3) lot.tranche3 = true;
      if (trade.tranche === "fear") lot.lastFearAddDate = trade.date;
    } else {
      const shares = Math.min(trade.shares, lot.shares);
      if (lot.shares > SHARE_EPS && shares > 0) {
        const fraction = Math.min(1, shares / lot.shares);
        lot.costBasis = Math.max(0, lot.costBasis * (1 - fraction));
        lot.shares = Math.max(0, lot.shares - shares);
      }
    }
  }

  for (const lot of lots.values()) {
    if (lot.shares < SHARE_EPS) {
      lot.shares = 0;
      lot.costBasis = 0;
    }
    if (!lot.tranche1 && !lot.tranche2 && !lot.tranche3 && lot.shares > SHARE_EPS) {
      lot.tranche1 = true;
    }
  }

  return [...lots.values()];
}

function netInvested(trades: Trade[], thesisId: string): number {
  const net = trades
    .filter((trade) => trade.thesisId === thesisId)
    .reduce((sum, trade) => sum + (trade.side === "buy" ? trade.dollars : -trade.dollars), 0);
  return Math.max(0, net);
}

export function cashBuckets(settings: Settings, theses: Thesis[], trades: Trade[]): CashBuckets {
  const alloc = allocate(settings.capital, settings.themeCount);
  const cash = totalCash(settings.capital, trades);
  const lots = replayTrades(trades, settings.coreTicker);
  const coreBuys = trades
    .filter((trade) => trade.sleeve === "core" && trade.side === "buy")
    .reduce((sum, trade) => sum + trade.dollars, 0);
  const coreReserve = Math.max(0, alloc.core - coreBuys);

  const active = theses.filter((thesis) => !thesis.archived);
  const earmarked = active.map((thesis) => {
    const target = themeTarget(alloc, thesis);
    const tranche = target / 3;
    const lot = lots.find((item) => item.thesisId === thesis.id);
    const unused = [lot?.tranche1, lot?.tranche2, lot?.tranche3].filter((done) => !done).length;
    return { thesisId: thesis.id, ticker: thesis.ticker, dollars: tranche * unused };
  });
  const earmarkedTotal = earmarked.reduce((sum, row) => sum + row.dollars, 0);
  const activeTargets = active.reduce((sum, thesis) => sum + themeTarget(alloc, thesis), 0);
  const archivedSpent = theses
    .filter((thesis) => thesis.archived)
    .reduce((sum, thesis) => sum + netInvested(trades, thesis.id), 0);
  const unassignedRaw = alloc.conviction - activeTargets - archivedSpent;
  const unassignedConviction = Math.max(0, unassignedRaw);
  const dryPowder = cents(cash - coreReserve - earmarkedTotal - unassignedConviction);
  return {
    totalCash: cents(cash),
    coreReserve: cents(coreReserve),
    earmarked: earmarked.map((row) => ({ ...row, dollars: cents(row.dollars) })),
    earmarkedTotal: cents(earmarkedTotal),
    unassignedConviction: cents(unassignedConviction),
    dryPowder,
    overAllocated: dryPowder < -0.01 || unassignedRaw < -0.01,
  };
}

export function quoteFor(prices: PriceBook | null, ticker: string) {
  if (!prices) return undefined;
  return prices.quotes[ticker.toUpperCase()] ?? prices.quotes[ticker];
}

export function markBook(
  settings: Settings,
  theses: Thesis[],
  trades: Trade[],
  prices: PriceBook | null,
): MarkedBook {
  const buckets = cashBuckets(settings, theses, trades);
  const lots = replayTrades(trades, settings.coreTicker).filter((lot) => lot.shares > SHARE_EPS);
  const gaps: string[] = [];
  const preliminary = lots.map((lot) => {
    const quote = quoteFor(prices, lot.ticker);
    const price = quote?.price ?? null;
    if (price == null) {
      gaps.push(`${lot.ticker}: no price in the snapshot. Weight, drawdown, and sized orders that need this price are withheld.`);
    } else if (quote?.sma200 == null) {
      gaps.push(`${lot.ticker}: price is present but the 200-day average is missing, so that signal cannot fire.`);
    }
    if (quote && quote.high52w == null && price != null) {
      gaps.push(`${lot.ticker}: 52-week high is missing, so the extreme-fear test cannot fire.`);
    }
    return {
      ...lot,
      price,
      sma200: quote?.sma200 ?? null,
      high52w: quote?.high52w ?? null,
      quoteAsOf: quote?.asOf ?? null,
      marketValue: price == null ? null : cents(lot.shares * price),
      avgCost: lot.shares > SHARE_EPS ? lot.costBasis / lot.shares : null,
    };
  });
  const complete = preliminary.every((position) => position.marketValue != null);
  const invested = complete ? preliminary.reduce((sum, position) => sum + (position.marketValue ?? 0), 0) : null;
  const bookValue = complete && invested != null ? cents(buckets.totalCash + invested) : null;
  const positions: MarkedPosition[] = preliminary.map((position) => ({
    ...position,
    weight: bookValue && position.marketValue != null ? position.marketValue / bookValue : null,
  }));
  return { cash: buckets.totalCash, bookValue, complete, gaps, positions };
}
