import type { CalibrationRow } from "./loop";

export interface Lesson {
  id: string;
  date: string;
  observation: string;
  evidence: string;
  affected: string;
  /** 0–1. */
  confidence: number;
}

/**
 * Pull an overconfident P(thesis) toward the bucket's hit rate.
 * Underconfident calls are left alone. An empty bucket is left alone.
 * `stated` is 0–100, matching the thesis card.
 */
export function shrinkThesisProbability(stated: number, calibration: CalibrationRow[]): number {
  if (!Number.isFinite(stated)) return stated;
  const unit = Math.min(100, Math.max(0, stated)) / 100;
  const row = calibration.find((bucket) => unit >= bucket.lo && (bucket.hi === 1 ? unit <= bucket.hi : unit < bucket.hi));
  if (!row || row.count === 0 || row.meanProbability == null || row.hitRate == null) return Math.min(100, Math.max(0, stated));
  const overconfidence = row.meanProbability - row.hitRate;
  if (overconfidence <= 0) return Math.min(100, Math.max(0, stated));
  const adjusted = Math.min(1, Math.max(0, unit - overconfidence));
  return Math.round(adjusted * 1000) / 10;
}

export function lessonsForPrompt(lessons: Lesson[]): string {
  if (lessons.length === 0) return "Lessons: none yet.";
  return lessons
    .map((lesson) => `Lesson ${lesson.date} (${lesson.affected}, confidence ${lesson.confidence}): ${lesson.observation} Evidence: ${lesson.evidence}`)
    .join("\n");
}
