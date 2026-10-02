/**
 * Playbook p.2 step 7: change at most one rule a quarter, version the rulebook, and do not
 * change a rule during a drawdown. Playbook p.1 rule 03 is the same lock.
 * Playbook p.1 rule 04 / p.2 meta-rule: after four quarters, a trailing conviction sleeve
 * is shrunk into the core and the rulebook cycles to v+1. That is not an editable threshold.
 */

export interface RuleThresholds {
  /** p.3 circuit breaker. Fixed rail. */
  drawdownFreeze: number;
  /** p.3 extreme greed: price this far above the 200-day average. Editable inside a band. */
  greedAboveSma: number;
  /** p.3 extreme fear: this far below the 52-week high. Editable inside a band. */
  fearBelowHigh: number;
  /** p.3 / p.4 trim above 20% of book. Fixed rail. */
  overweight: number;
  /** p.3 cap: no buy above 15% of book. Fixed rail. */
  positionCap: number;
  /** p.3 trim band is 20–25%. v1.0 uses 20%, the smaller cut. Editable only inside that band. */
  trimFraction: number;
  /** p.3 top decile. Editable inside 85–95. */
  topDecile: number;
  /** p.3 bottom quartile. Editable inside 15–30. */
  bottomQuartile: number;
}

export type EditableParameter = "greedAboveSma" | "fearBelowHigh" | "trimFraction" | "topDecile" | "bottomQuartile";

export interface RuleChange {
  id: string;
  date: string;
  quarterKey: string;
  fromVersion: string;
  toVersion: string;
  parameter: EditableParameter | "cycle";
  previous: number;
  next: number;
  evidence: string;
}

export interface Rulebook {
  version: string;
  cycle: number;
  adoptedOn: string;
  thresholds: RuleThresholds;
  changelog: RuleChange[];
}

export function defaultThresholds(): RuleThresholds {
  return {
    drawdownFreeze: 0.3,
    greedAboveSma: 0.5,
    fearBelowHigh: 0.3,
    overweight: 0.2,
    positionCap: 0.15,
    trimFraction: 0.2,
    topDecile: 90,
    bottomQuartile: 25,
  };
}

/** Imported books keep editable values only inside their bands. The 15/20/30 rails always reset. */
export function sanitizeThresholds(value: unknown): RuleThresholds {
  const base = defaultThresholds();
  if (!value || typeof value !== "object") return base;
  const input = value as Partial<RuleThresholds>;
  const next = { ...base };
  for (const key of Object.keys(BANDS) as EditableParameter[]) {
    const raw = input[key];
    const band = BANDS[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= band.min && raw <= band.max) next[key] = raw;
  }
  return next;
}

export function defaultRulebook(adoptedOn: string): Rulebook {
  return { version: "1.0", cycle: 1, adoptedOn, thresholds: defaultThresholds(), changelog: [] };
}

const BANDS: Record<EditableParameter, { min: number; max: number }> = {
  greedAboveSma: { min: 0.4, max: 0.75 },
  fearBelowHigh: { min: 0.2, max: 0.4 },
  trimFraction: { min: 0.2, max: 0.25 },
  topDecile: { min: 85, max: 95 },
  bottomQuartile: { min: 15, max: 30 },
};

export function isEditableParameter(value: string): value is EditableParameter {
  return value in BANDS;
}

/** p.1 rule 03. Any mark below the peak is a drawdown. Missing marks stay locked. */
export function ruleEditsLocked(bookValue: number | null, peak: number | null): { locked: boolean; reason: string } {
  if (bookValue == null || peak == null || !(peak > 0)) {
    return { locked: true, reason: "Book value is incomplete. Rule edits stay locked until the book can be marked. No drawdown is invented." };
  }
  if (bookValue < peak - 0.005) {
    return { locked: true, reason: "The book is below its peak. Rule 03: never change a rule during a drawdown." };
  }
  return { locked: false, reason: "" };
}

export function bumpMinor(version: string): string {
  const [major, minor] = version.split(".").map(Number);
  return `${major}.${(Number.isFinite(minor) ? minor : 0) + 1}`;
}

export function bumpMajor(version: string): string {
  return `${Number(version.split(".")[0]) + 1}.0`;
}

export function proposeRuleChange(
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
  },
): { ok: true; rulebook: Rulebook } | { ok: false; reason: string } {
  const lock = ruleEditsLocked(input.bookValue, input.peak);
  if (lock.locked) return { ok: false, reason: lock.reason };
  if (!isEditableParameter(input.parameter)) {
    return { ok: false, reason: "That rail does not bend. The 15% cap, the 20% trim line, the 30% circuit breaker, and the four standing rules stay as written." };
  }
  const band = BANDS[input.parameter];
  if (!Number.isFinite(input.next) || input.next < band.min || input.next > band.max) {
    return { ok: false, reason: `${input.parameter} must stay between ${band.min} and ${band.max}.` };
  }
  if (input.evidence.trim().length < 20) {
    return { ok: false, reason: "A rule change needs the evidence behind it, at least a sentence." };
  }
  if (rulebook.changelog.some((change) => change.quarterKey === input.quarterKey && change.parameter !== "cycle")) {
    return { ok: false, reason: "This quarter already has a rule change. At most one." };
  }
  const previous = rulebook.thresholds[input.parameter];
  if (previous === input.next) return { ok: false, reason: "That is already the live value." };
  const toVersion = bumpMinor(rulebook.version);
  const change: RuleChange = {
    id: input.id,
    date: input.date,
    quarterKey: input.quarterKey,
    fromVersion: rulebook.version,
    toVersion,
    parameter: input.parameter,
    previous,
    next: input.next,
    evidence: input.evidence.trim(),
  };
  return {
    ok: true,
    rulebook: {
      ...rulebook,
      version: toVersion,
      thresholds: { ...rulebook.thresholds, [input.parameter]: input.next },
      changelog: [...rulebook.changelog, change],
    },
  };
}

/**
 * p.2 "NEXT CYCLE / RULEBOOK v+1". Applying rule 04 versions the book. It is not a
 * threshold edit, so the drawdown lock and the one-change cap do not block it.
 */
export function applyMetaRuleCycle(rulebook: Rulebook, input: { id: string; date: string; quarterKey: string; evidence: string }): Rulebook {
  const toVersion = bumpMajor(rulebook.version);
  const change: RuleChange = {
    id: input.id,
    date: input.date,
    quarterKey: input.quarterKey,
    fromVersion: rulebook.version,
    toVersion,
    parameter: "cycle",
    previous: rulebook.cycle,
    next: rulebook.cycle + 1,
    evidence: input.evidence.trim(),
  };
  return { ...rulebook, version: toVersion, cycle: rulebook.cycle + 1, changelog: [...rulebook.changelog, change] };
}

/** p.1 rule 04 and p.4 quarter 4. Missing returns do not count as a loss. */
export function metaRuleVerdict(
  convictionReturn: number | null,
  qqqReturn: number | null,
  quartersElapsed: number,
): { due: boolean; shrink: boolean; reason: string } {
  if (quartersElapsed < 4) {
    return { due: false, shrink: false, reason: "The first meta-rule test is after four quarters." };
  }
  if (convictionReturn == null || qqqReturn == null) {
    return { due: true, shrink: false, reason: "Insufficient data, no action. The sleeve is not cut without both return series." };
  }
  if (convictionReturn < qqqReturn) {
    return {
      due: true,
      shrink: true,
      reason: "The conviction sleeve trails QQQ after four quarters. Rule 04: own more of the index. Shrink the sleeve and move that capital into the core.",
    };
  }
  return { due: true, shrink: false, reason: "The conviction sleeve leads QQQ on this test, so it keeps its place." };
}
