import type { FeedbackTag, UserFeedback } from "./boss";

export const FEEDBACK_KEY = "rsi.feedback";

const TAGS: readonly FeedbackTag[] = ["exclusion", "pace", "voice", "risk", "rule-change", "note"];

type Memory = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/** Boss notes stay out of the desk export. They live under their own key. */
export function loadFeedback(store: Memory | null): UserFeedback[] {
  if (!store) return [];
  const raw = store.getItem(FEEDBACK_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isFeedback);
  } catch {
    return [];
  }
}

export function saveFeedback(store: Memory | null, items: readonly UserFeedback[]): void {
  if (!store) return;
  store.setItem(FEEDBACK_KEY, JSON.stringify(items));
}

function isFeedback(value: unknown): value is UserFeedback {
  if (!value || typeof value !== "object") return false;
  const row = value as UserFeedback;
  return typeof row.id === "string" && typeof row.date === "string" && typeof row.text === "string" && TAGS.includes(row.tag);
}
