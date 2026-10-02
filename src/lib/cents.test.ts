import { describe, expect, it } from "vitest";
import { floorOrder, fromCents, splitCents, toCents } from "./cents";

describe("cents", () => {
  it("splits weights so the parts sum to the original cents", () => {
    const parts = splitCents(1_234_567, [0.3, 0.45, 0.25]);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(1_234_567);
    expect(parts.every((part) => Number.isInteger(part))).toBe(true);
  });

  it("rejects non-finite money", () => {
    expect(toCents(Number.NaN)).toBeNull();
    expect(toCents(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("floors shares and never spends more than the budget", () => {
    const order = floorOrder(10_001, 300);
    expect(order.costCents).toBeLessThanOrEqual(10_001);
    expect(order.shares * 300).toBeLessThanOrEqual(10_001 + 0.01);
    expect(fromCents(order.costCents)).toBeLessThanOrEqual(100.01);
  });

  it("keeps an even fill exact", () => {
    const order = floorOrder(500_000, 6_000);
    expect(order.costCents).toBe(500_000);
    expect(order.shares).toBeCloseTo(5000 / 60, 6);
  });
});
