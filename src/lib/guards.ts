import { floorOrder, fromCents, toCents } from "./cents";
import { buyBlockedReason, type InstrumentClass } from "./instruments";
import { averageDownBlocked, fullExitAllowed } from "./loop";
import { fitBuy } from "./orders";
import type { TrancheTag } from "../types";

/**
 * Playbook p.1 rules 01 and 02, and p.3: the ledger may record only a sized, legal suggestion.
 * Tranches 2 and 3 are engine actions. A hand entry cannot average down or exit on sentiment.
 */
export function reviewManualTrade(input: {
  side: "buy" | "sell";
  dollars: number;
  price: number;
  sleeve: "core" | "conviction";
  tranche: TrancheTag | null;
  heldShares: number;
  missedMilestones: number;
  killHit: boolean;
  exitReason: "trim" | "kill" | "meta-rule" | "sentiment";
  fromEngine: boolean;
  alreadyDeployed?: boolean;
  marketValue: number | null;
  bookValue: number | null;
  cash: number;
  instrument?: InstrumentClass;
}): { ok: true; dollars: number; shares: number } | { ok: false; reason: string } {
  if (!(input.price > 0) || !Number.isFinite(input.price) || !(input.dollars > 0) || !Number.isFinite(input.dollars)) {
    return { ok: false, reason: "Enter a dollar amount and the price you actually paid or received." };
  }
  if (input.side === "buy") {
    const blocked = buyBlockedReason(input.instrument ?? "unknown");
    if (blocked) return { ok: false, reason: blocked };
    if (input.tranche === 1 && input.alreadyDeployed) {
      return { ok: false, reason: "Tranche 1 is already on. Tranches 2 and 3 come only from the execution engine." };
    }
    if (input.sleeve === "conviction" && !input.fromEngine && input.tranche != null && input.tranche !== 1) {
      return { ok: false, reason: "Tranches 2 and 3 come only from the execution engine. The ledger will not record them by hand." };
    }
    if (input.sleeve === "conviction" && averageDownBlocked(input.missedMilestones)) {
      return { ok: false, reason: "A missed milestone freezes adds. Never average down." };
    }
    if (input.bookValue == null || !(input.bookValue > 0)) {
      return { ok: false, reason: "Insufficient data, no action. The book is not fully marked, so the 15% cap cannot be checked." };
    }
    const fit = fitBuy({
      desiredDollars: input.dollars,
      price: input.price,
      earmarked: input.cash,
      dry: 0,
      marketValue: input.marketValue ?? 0,
      bookValue: input.bookValue,
      positionCap: 0.15,
      useEarmarked: true,
    });
    if (!fit.ok) return { ok: false, reason: fit.reason };
    return { ok: true, dollars: fit.dollars, shares: fit.shares };
  }

  if (input.fromEngine && input.instrument && input.instrument !== "equity") {
    return { ok: false, reason: "RSI does not recommend a sell of an ETF, fund, or index. SPY and QQQ are benchmarks only." };
  }
  if (input.exitReason === "sentiment") {
    return { ok: false, reason: "Sentiment is not an exit. A full exit is a kill, including a second milestone miss, or rule 04." };
  }
  if (input.exitReason === "kill" && !input.killHit && input.missedMilestones < 2) {
    return { ok: false, reason: "A kill exit needs the kill condition or a second missed milestone." };
  }
  const allowFull = fullExitAllowed(input.exitReason);
  const priceCents = toCents(input.price);
  const desiredCents = toCents(input.dollars);
  if (priceCents == null || desiredCents == null) return { ok: false, reason: "Insufficient data, no action." };
  const order = floorOrder(desiredCents, priceCents);
  if (order.shares <= 0) return { ok: false, reason: "The floored share count is zero. No sell is placed." };
  if (order.shares > input.heldShares + 1e-9) {
    return { ok: false, reason: "That sell is larger than the shares on the book." };
  }
  if (!allowFull && order.shares >= input.heldShares - 1e-9) {
    return { ok: false, reason: "A trim must not empty the position. Only the kill condition, or rule 04, exits 100%." };
  }
  return { ok: true, dollars: fromCents(order.costCents), shares: Math.min(order.shares, input.heldShares) };
}
