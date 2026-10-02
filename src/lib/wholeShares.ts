/**
 * Orders are whole shares. Buys round down. A missing price sizes nothing.
 */

export interface WholeOrder {
  shares: number;
  dollars: number;
  price: number;
}

export function wholeBuy(dollars: number, price: number | null): WholeOrder | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  const shares = Math.floor(dollars / price);
  if (shares < 1) return null;
  const spent = Math.round(shares * price * 100) / 100;
  return { shares, dollars: spent, price };
}

/** A sell cannot exceed the whole shares already held. Fractional leftovers stay. */
export function wholeSell(desiredDollars: number, price: number | null, heldShares: number): WholeOrder | null {
  const held = Math.floor(heldShares);
  if (held < 1) return null;
  const sized = wholeBuy(desiredDollars, price);
  if (!sized) return null;
  const shares = Math.min(sized.shares, held);
  if (shares < 1 || price == null) return null;
  return { shares, dollars: Math.round(shares * price * 100) / 100, price };
}
