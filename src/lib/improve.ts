import { bumpMinor, isEditableParameter, proposeRuleChange, type EditableParameter, type Rulebook } from "./rulebook";

/** These cannot be learned away. Feedback and quarterly proposals both stop here. */
export const IMMUTABLE = [
  "drawdownFreeze",
  "overweight",
  "positionCap",
  "stocksOnly",
  "noEtf",
  "noTbill",
  "circuitBreaker",
  "fourRules",
] as const;

export const POSITION_CAP = 0.15;
export const EVIDENCE_BAR = 0.02;
export const MIN_REPLAY_SAMPLE = 8;

export function isImmutable(parameter: string): boolean {
  return (IMMUTABLE as readonly string[]).includes(parameter);
}

export function evidenceClears(input: { evidence: string; sampleSize: number; replayDelta: number }): { ok: boolean; reason: string } {
  if (input.evidence.trim().length < 20) return { ok: false, reason: "A change needs a sentence of evidence." };
  if (input.sampleSize < MIN_REPLAY_SAMPLE) return { ok: false, reason: "The replay needs at least 8 resolved cases." };
  if (!(input.replayDelta >= EVIDENCE_BAR)) return { ok: false, reason: "The replay did not clear the evidence bar. The hit rate has to improve by at least 2 points." };
  return { ok: true, reason: "The replay cleared the evidence bar." };
}

export interface ReplayCase {
  signal: number;
  outcome: 0 | 1;
}

/** Hit rate among cases that would have fired at this threshold. Unfired cases are not misses. */
export function replayHitRate(cases: ReplayCase[], threshold: number): { rate: number | null; fired: number } {
  const fired = cases.filter((row) => row.signal >= threshold);
  if (fired.length === 0) return { rate: null, fired: 0 };
  return { rate: fired.reduce((sum, row) => sum + row.outcome, 0) / fired.length, fired: fired.length };
}

export function considerChange(
  rulebook: Rulebook,
  input: {
    id: string;
    date: string;
    quarterKey: string;
    parameter: string;
    next: number;
    evidence: string;
    bookValue: number | null;
    peak: number | null;
    sampleSize: number;
    replayDelta: number;
  },
): { ok: boolean; rulebook: Rulebook; reason: string } {
  if (isImmutable(input.parameter) || !isEditableParameter(input.parameter)) {
    return { ok: false, rulebook, reason: "That rule is immutable. The 15% cap, the 20% trim line, the 30% circuit breaker, stocks only, and the Four Rules stay as written." };
  }
  const bar = evidenceClears(input);
  if (!bar.ok) return { ok: false, rulebook, reason: bar.reason };
  const proposed = proposeRuleChange(rulebook, {
    id: input.id,
    date: input.date,
    quarterKey: input.quarterKey,
    parameter: input.parameter,
    next: input.next,
    evidence: input.evidence,
    bookValue: input.bookValue,
    peak: input.peak,
  });
  if (!proposed.ok) return { ok: false, rulebook, reason: proposed.reason };
  return { ok: true, rulebook: proposed.rulebook, reason: "One change was applied and versioned." };
}

export interface AppliedChange {
  id: string;
  quarterKey: string;
  parameter: EditableParameter;
  previous: number;
  next: number;
  /** Higher is worse. Brier, or one minus the hit rate. */
  metricAtChange: number;
}

/**
 * If the next quarter's tracked metric gets worse, restore the previous value.
 * This is not a new experiment, so a drawdown does not block it.
 */
export function maybeRollback(
  rulebook: Rulebook,
  change: AppliedChange,
  input: { id: string; date: string; quarterKey: string; metricNow: number },
): { rulebook: Rulebook; rolledBack: boolean; reason: string } {
  if (input.quarterKey === change.quarterKey) {
    return { rulebook, rolledBack: false, reason: "Rollback waits for the next quarter." };
  }
  if (!(input.metricNow > change.metricAtChange + 0.01)) {
    return { rulebook, rolledBack: false, reason: "The next quarter's evidence does not go against the change." };
  }
  if (isImmutable(change.parameter)) {
    return { rulebook, rolledBack: false, reason: "That rule is immutable." };
  }
  const version = bumpMinor(rulebook.version);
  return {
    rolledBack: true,
    reason: "Rolled back. The next quarter's evidence went against the change.",
    rulebook: {
      ...rulebook,
      version,
      thresholds: { ...rulebook.thresholds, [change.parameter]: change.previous },
      changelog: [
        ...rulebook.changelog,
        {
          id: input.id,
          date: input.date,
          quarterKey: input.quarterKey,
          fromVersion: rulebook.version,
          toVersion: version,
          parameter: change.parameter,
          previous: change.next,
          next: change.previous,
          evidence: "Rolled back. The next quarter's evidence went against the change.",
        },
      ],
    },
  };
}
