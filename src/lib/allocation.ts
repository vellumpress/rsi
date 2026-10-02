import type { ThemeCount } from "../types";
import { fromCents, MAX_CAPITAL_DOLLARS, splitCents, toCents } from "./cents";
import { cents } from "./money";

export const CORE_WEIGHT = 0.3;
export const CONVICTION_WEIGHT = 0.45;
export const DRY_POWDER_WEIGHT = 0.25;
export const POSITION_CAP_WEIGHT = 0.15;
export const TRANCHES = 3;

export interface Allocation {
  capital: number;
  themeCount: ThemeCount;
  core: number;
  conviction: number;
  dryPowder: number;
  coreTranche: number;
  perTheme: number;
  themeTranche: number;
  /** Planning cap: 15% of funded capital. The live engine also caps at 15% of the marked book. */
  positionCap: number;
}

export function isThemeCount(n: number): n is ThemeCount {
  return n === 3 || n === 4 || n === 5;
}

export function allocate(capital: number, themeCount: ThemeCount): Allocation {
  const safe = safeAllocate(capital, themeCount);
  if (!safe.ok || !isThemeCount(themeCount)) throw new Error(safe.ok ? "Conviction holds 3, 4, or 5 themes." : safe.error);
  return safe.allocation as Allocation;
}

export interface SafeAllocation extends Omit<Allocation, "themeCount"> {
  themeCount: number;
  warning?: string;
}

/**
 * p.1 weights and p.4 tranche table. Amounts are integer cents.
 * Zero, negative, and unsafe amounts are refused. One theme is capped at 15%.
 * More than five themes is refused rather than diluted silently.
 */
export function safeAllocate(capital: number, themeCount: number): { ok: true; allocation: SafeAllocation } | { ok: false; error: string } {
  if (!Number.isFinite(capital) || capital <= 0) return { ok: false, error: "Capital must be a positive amount." };
  if (capital > MAX_CAPITAL_DOLLARS) return { ok: false, error: "That amount is too large to size safely." };
  if (!Number.isInteger(themeCount) || themeCount < 0 || themeCount > 5) {
    return { ok: false, error: "Conviction holds 3, 4, or 5 themes. Zero is an empty sleeve. More than five is refused." };
  }
  const total = toCents(capital);
  if (total == null) return { ok: false, error: "Capital must be a positive amount." };
  const [coreC, convictionC, dryC] = splitCents(total, [CORE_WEIGHT, CONVICTION_WEIGHT, DRY_POWDER_WEIGHT]);
  const capC = splitCents(total, [POSITION_CAP_WEIGHT, 1 - POSITION_CAP_WEIGHT])[0];
  let perThemeC = 0;
  let warning: string | undefined;
  if (themeCount === 0) {
    warning = "No themes. The conviction sleeve stays in T-bills until a card is approved.";
  } else if (themeCount < 3) {
    perThemeC = Math.min(Math.floor(convictionC / themeCount), capC);
    warning = "The playbook runs 3 to 5 themes. This target is capped at 15% of the book.";
  } else {
    perThemeC = Math.floor(convictionC / themeCount);
  }
  const coreTrancheC = splitCents(coreC, [1 / 3, 1 / 3, 1 / 3])[0];
  const themeTrancheC = perThemeC === 0 ? 0 : splitCents(perThemeC, [1 / 3, 1 / 3, 1 / 3])[0];
  return {
    ok: true,
    allocation: {
      capital: fromCents(total),
      themeCount,
      core: fromCents(coreC),
      conviction: fromCents(convictionC),
      dryPowder: fromCents(dryC),
      coreTranche: fromCents(coreTrancheC),
      perTheme: fromCents(perThemeC),
      themeTranche: fromCents(themeTrancheC),
      positionCap: fromCents(capC),
      warning,
    },
  };
}

export function themeTarget(
  alloc: Allocation,
  thesis: { targetMode: "plan" | "custom"; targetDollars: number | null },
): number {
  if (thesis.targetMode === "custom" && thesis.targetDollars != null && Number.isFinite(thesis.targetDollars)) {
    return Math.min(Math.max(0, thesis.targetDollars), alloc.positionCap);
  }
  return Math.min(alloc.perTheme, alloc.positionCap);
}

export function displayCents(n: number): number {
  return cents(n);
}
