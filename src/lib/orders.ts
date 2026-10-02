import { floorOrder, fromCents, toCents } from "./cents";

export interface BuyFit {
  ok: boolean;
  dollars: number;
  shares: number;
  fromEarmarked: number;
  fromDry: number;
  reason: string;
}

export interface SellFit {
  ok: boolean;
  dollars: number;
  shares: number;
  reason: string;
}

/**
 * Playbook p.3: tranches 2 and 3 use earmarked cash first, then dry powder.
 * No buy takes a position above 15% of the book.
 * Shares are floored. A buy is not sized from a missing or non-positive price.
 */
export function fitBuy(input: {
  desiredDollars: number;
  price: number | null;
  earmarked: number;
  dry: number;
  marketValue: number | null;
  bookValue: number | null;
  positionCap: number;
  useEarmarked: boolean;
}): BuyFit {
  const empty = (reason: string): BuyFit => ({ ok: false, dollars: 0, shares: 0, fromEarmarked: 0, fromDry: 0, reason });
  if (input.price == null || !(input.price > 0) || input.marketValue == null || input.bookValue == null || !(input.bookValue > 0)) {
    return empty("Insufficient data, no action.");
  }
  const priceCents = toCents(input.price);
  const marketCents = toCents(input.marketValue);
  const bookCents = toCents(input.bookValue);
  const desiredCents = toCents(Math.max(0, input.desiredDollars));
  const earmarkedCents = toCents(Math.max(0, input.earmarked));
  const dryCents = toCents(Math.max(0, input.dry));
  if (priceCents == null || marketCents == null || bookCents == null || desiredCents == null || earmarkedCents == null || dryCents == null) {
    return empty("Insufficient data, no action.");
  }
  const room = Math.floor(input.positionCap * bookCents) - marketCents;
  if (room <= 0) return empty("The position is already at the 15% cap, so no buy is placed.");
  const budget = Math.min(desiredCents, room);
  const fromEarmarked = input.useEarmarked ? Math.min(earmarkedCents, budget) : 0;
  const fromDry = Math.min(dryCents, budget - fromEarmarked);
  const cash = fromEarmarked + fromDry;
  if (cash <= 0) return empty("Earmarked cash and dry powder do not have funds for this add.");
  const order = floorOrder(cash, priceCents);
  if (order.costCents <= 0 || order.shares <= 0) return empty("The floored share count is zero. No buy is placed.");
  let earmarkedSpent = Math.min(fromEarmarked, order.costCents);
  let drySpent = order.costCents - earmarkedSpent;
  if (!input.useEarmarked) {
    earmarkedSpent = 0;
    drySpent = order.costCents;
  }
  return {
    ok: true,
    dollars: fromCents(order.costCents),
    shares: order.shares,
    fromEarmarked: fromCents(earmarkedSpent),
    fromDry: fromCents(drySpent),
    reason: "Sized inside the cash buckets and the 15% cap.",
  };
}

/**
 * Playbook p.3: a trim is never a full exit. Shares sold cannot exceed shares held.
 * Playbook p.1 rule 02: a full exit is allowed only when the caller sets allowFullExit (kill or rule 04).
 */
export function fitSell(input: {
  desiredDollars: number;
  price: number | null;
  heldShares: number;
  marketValue: number | null;
  allowFullExit: boolean;
}): SellFit {
  const empty = (reason: string): SellFit => ({ ok: false, dollars: 0, shares: 0, reason });
  if (input.price == null || !(input.price > 0) || input.marketValue == null || !(input.heldShares > 0)) {
    return empty("Insufficient data, no action.");
  }
  const priceCents = toCents(input.price);
  const desiredCents = toCents(Math.max(0, input.desiredDollars));
  if (priceCents == null || desiredCents == null) return empty("Insufficient data, no action.");
  if (input.allowFullExit) {
    const cost = toCents(input.heldShares * input.price);
    return {
      ok: true,
      dollars: fromCents(cost ?? 0),
      shares: input.heldShares,
      reason: "Full exit. Share count is the position, not more.",
    };
  }
  const order = floorOrder(desiredCents, priceCents);
  const shares = Math.min(input.heldShares, order.shares);
  if (!(shares > 0)) return empty("The floored trim is zero. No sell is placed.");
  if (shares >= input.heldShares - 1e-9) {
    return empty("A trim must not empty the position. Only the kill condition exits 100%.");
  }
  const cost = toCents(shares * input.price);
  return { ok: true, dollars: fromCents(cost ?? 0), shares, reason: "Trim sized below a full exit." };
}
