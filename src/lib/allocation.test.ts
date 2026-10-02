import { describe, expect, it } from "vitest";
import { toCents } from "./cents";
import { allocate, safeAllocate, themeTarget } from "./allocation";

describe("allocation", () => {
  it("splits $100,000 into 30 / 45 / 25", () => {
    const plan = allocate(100_000, 3);
    expect(plan.core).toBe(30_000);
    expect(plan.conviction).toBe(45_000);
    expect(plan.dryPowder).toBe(25_000);
    expect(plan.core + plan.conviction + plan.dryPowder).toBe(100_000);
    expect(plan.coreTranche).toBe(10_000);
    expect(plan.coreTranche * 3).toBe(plan.core);
  });

  it("scales any funded amount by the same weights", () => {
    const plan = allocate(50_000, 3);
    expect(plan.core).toBe(15_000);
    expect(plan.conviction).toBe(22_500);
    expect(plan.dryPowder).toBe(12_500);
    expect(plan.coreTranche).toBe(5_000);
    expect(plan.perTheme).toBe(7_500);
    expect(plan.themeTranche).toBe(2_500);
    expect(plan.positionCap).toBe(7_500);

    const odd = allocate(12_345.67, 4);
    const parts = [odd.core, odd.conviction, odd.dryPowder].map((value) => toCents(value) ?? 0);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(toCents(12_345.67));
  });

  it("refuses zero, negative, huge, and more than five themes, and caps one theme at 15%", () => {
    expect(safeAllocate(0, 3).ok).toBe(false);
    expect(safeAllocate(-100, 3).ok).toBe(false);
    expect(safeAllocate(1e15, 3).ok).toBe(false);
    expect(safeAllocate(100_000, 6).ok).toBe(false);
    const none = safeAllocate(100_000, 0);
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.allocation.perTheme).toBe(0);
    const one = safeAllocate(100_000, 1);
    expect(one.ok).toBe(true);
    if (one.ok) expect(one.allocation.perTheme).toBe(15_000);
  });

  it("matches the playbook tranche table for 3, 4, and 5 themes", () => {
    const three = allocate(100_000, 3);
    expect(three.perTheme).toBe(15_000);
    expect(three.themeTranche).toBe(5_000);
    expect(three.positionCap).toBe(15_000);

    const four = allocate(100_000, 4);
    expect(four.perTheme).toBe(11_250);
    expect(four.themeTranche).toBe(3_750);

    const five = allocate(100_000, 5);
    expect(five.perTheme).toBe(9_000);
    expect(five.themeTranche).toBe(3_000);
  });

  it("caps a custom target at 15% of funded capital", () => {
    const plan = allocate(100_000, 5);
    expect(themeTarget(plan, { targetMode: "plan", targetDollars: null })).toBe(9_000);
    expect(themeTarget(plan, { targetMode: "custom", targetDollars: 20_000 })).toBe(15_000);
    expect(themeTarget(plan, { targetMode: "custom", targetDollars: 4_000 })).toBe(4_000);
  });

  it("rejects a theme count outside 3–5", () => {
    expect(() => allocate(100_000, 2 as 3)).toThrow(/3, 4, or 5/);
  });
});
