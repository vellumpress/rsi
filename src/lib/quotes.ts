import { addDays, isValidISO, parseISO, weekdayUTC } from "./dates";
import { isNyseHoliday } from "./holidays";

/**
 * Playbook p.3 signals are computed only from a sane quote.
 * A missing, non-positive, jumped, stale, or short history does not become a trade.
 */

export type DataBlock = "ok" | "short" | "stale" | "invalid" | "missing";

export interface QuoteCheckInput {
  price: number | null;
  previousClose?: number | null;
  asOf: string | null;
  bars: number;
}

export interface QuoteCheck {
  block: DataBlock;
  ageTradingDays: number | null;
  message: string;
}

/** Weekdays strictly after `from` up to and including `today`. Weekends and NYSE full closures are not trading days. */
export function tradingDaysBetween(from: string, today: string): number | null {
  if (!isValidISO(from) || !isValidISO(today)) return null;
  if (today < from) return null;
  let count = 0;
  let cursor = from;
  while (cursor < today) {
    cursor = addDays(cursor, 1);
    const day = weekdayUTC(cursor);
    if (day !== 0 && day !== 6 && !isNyseHoliday(cursor)) count += 1;
  }
  return count;
}

export function assessQuote(quote: QuoteCheckInput | undefined, today: string): QuoteCheck {
  if (!quote || quote.price == null) {
    return { block: "missing", ageTradingDays: null, message: "Insufficient data, no action. No price in the snapshot." };
  }
  if (!Number.isFinite(quote.price) || quote.price <= 0) {
    return { block: "invalid", ageTradingDays: null, message: "Insufficient data, no action. The price is zero, negative, or not a number." };
  }
  if (quote.previousClose != null && quote.previousClose > 0) {
    const jump = Math.abs(quote.price / quote.previousClose - 1);
    if (jump > 0.4) {
      return { block: "invalid", ageTradingDays: null, message: "Insufficient data, no action. The price jumped more than 40% versus the prior close." };
    }
  }
  if (!quote.asOf || !isValidISO(quote.asOf)) {
    return { block: "stale", ageTradingDays: null, message: "Insufficient data, no action. The snapshot has no session date." };
  }
  const age = tradingDaysBetween(quote.asOf, today);
  if (age == null) {
    return { block: "invalid", ageTradingDays: null, message: "Insufficient data, no action. The session date is after today." };
  }
  // About two trading days. Older than that blocks buys and sells.
  if (age > 2) {
    return { block: "stale", ageTradingDays: age, message: `Insufficient data, no action. The quote is ${age} trading days old.` };
  }
  if (quote.bars < 200) {
    return { block: "short", ageTradingDays: age, message: "Fewer than 200 closes. Price signals that need that history are not computed." };
  }
  return { block: "ok", ageTradingDays: age, message: "Quote passed the sanity checks." };
}

export function sessionDate(isoDateTime: string | null): string | null {
  if (!isoDateTime) return null;
  const date = isoDateTime.slice(0, 10);
  return isValidISO(date) ? date : null;
}

export function assertNeverUsed(value: number | null, block: DataBlock): number | null {
  if (block === "ok") return value;
  if (block === "short") return null;
  return null;
}

export function weekdayName(iso: string): string {
  const { y, m, d } = parseISO(iso);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
}
