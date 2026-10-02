/** Shown when an account is not on the allowlist. Signup, functions, and the desk use the same sentence. */
export const PRIVATE_DESK = "This RSI desk is private.";

export const GROK_MINUTE_LIMIT = 12;
export const GROK_DAY_LIMIT = 80;

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** True only when the address is on the server allowlist. The list itself is not stored here. */
export function emailAllowed(email: string | null | undefined, allowlist: readonly string[]): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized.includes("@")) return false;
  return allowlist.some((entry) => normalizeEmail(entry) === normalized);
}

/** Counts already recorded in the window. A call at the limit is refused before xAI is contacted. */
export function rateLimitDecision(minuteCount: number, dayCount: number): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(minuteCount) || !Number.isFinite(dayCount) || minuteCount < 0 || dayCount < 0) {
    return { ok: false, error: "Grok is rate limited for this account. Wait and try again. Nothing was written." };
  }
  if (minuteCount >= GROK_MINUTE_LIMIT) {
    return { ok: false, error: "Grok is rate limited for this account. Wait a minute and try again. Nothing was written." };
  }
  if (dayCount >= GROK_DAY_LIMIT) {
    return { ok: false, error: "Grok is rate limited for this account today. Nothing was written." };
  }
  return { ok: true };
}
