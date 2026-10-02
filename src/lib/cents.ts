/** Integer cents. Dollar floats are not used for order sizing. */

export const MICROSHARES = 1_000_000;
/** Personal-account guard. Larger amounts are rejected rather than rounded unsafely. */
export const MAX_CAPITAL_DOLLARS = 100_000_000;

export function toCents(dollars: number): number | null {
  if (!Number.isFinite(dollars)) return null;
  const cents = Math.round(dollars * 100);
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** Largest-remainder split. Parts are integers and sum to totalCents. */
export function splitCents(totalCents: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(totalCents)) throw new Error("Cent total is not a safe integer.");
  const raw = weights.map((weight) => totalCents * weight);
  const floors = raw.map((value) => Math.floor(value));
  let left = totalCents - floors.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const item of order) {
    if (left <= 0) break;
    floors[item.index] += 1;
    left -= 1;
  }
  return floors;
}

/**
 * Shares floored to 1e-6 so the order cannot round up through the cash budget.
 * Cost is in cents and never exceeds budgetCents.
 */
export function floorOrder(budgetCents: number, priceCents: number): { shares: number; costCents: number } {
  if (!Number.isSafeInteger(budgetCents) || !Number.isSafeInteger(priceCents) || budgetCents <= 0 || priceCents <= 0) {
    return { shares: 0, costCents: 0 };
  }
  const whole = Math.floor(budgetCents / priceCents);
  const remainder = budgetCents % priceCents;
  const frac = Math.floor((remainder * MICROSHARES) / priceCents);
  let micro = whole * MICROSHARES + frac;
  if (!Number.isSafeInteger(micro)) return { shares: 0, costCents: 0 };
  let cost = Math.round((micro * priceCents) / MICROSHARES);
  while (micro > 0 && cost > budgetCents) {
    micro -= 1;
    cost = Math.round((micro * priceCents) / MICROSHARES);
  }
  return { shares: micro / MICROSHARES, costCents: micro === 0 ? 0 : cost };
}
