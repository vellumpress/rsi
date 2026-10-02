import { brierScore, calibrationTable, type CalibrationRow, type ProbabilityCall } from "./loop";

export interface LoggedRecommendation {
  id: string;
  date: string;
  ticker: string;
  side: "buy" | "sell";
  rule: string;
  theme: string;
  /** 0–1. Null until the card has a probability. */
  probability: number | null;
  expectedOutcome: string;
  referencePrice: number;
  shares: number;
  dollars: number;
  reason: string;
  /** 1 hit, 0 miss, null not yet scored. */
  outcome: 0 | 1 | null;
}

export interface RecordedFill {
  recommendationId: string;
  ticker: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  date: string;
}

export interface Slippage {
  /** Positive means the fill was worse than the reference close. */
  priceGap: number;
  dollars: number;
  days: number;
}

/** Compare a recorded fill with the recommendation. Missing or mismatched rows are not scored as zero. */
export function executionSlippage(recommendation: LoggedRecommendation, fill: RecordedFill | null): Slippage | null {
  if (!fill) return null;
  if (fill.recommendationId !== recommendation.id) return null;
  if (fill.ticker.toUpperCase() !== recommendation.ticker.toUpperCase() || fill.side !== recommendation.side) return null;
  if (!(recommendation.referencePrice > 0) || !(fill.price > 0) || !(fill.shares > 0)) return null;
  const worse = recommendation.side === "buy" ? fill.price - recommendation.referencePrice : recommendation.referencePrice - fill.price;
  const priceGap = worse / recommendation.referencePrice;
  const shares = Math.min(fill.shares, recommendation.shares);
  const days = calendarDays(recommendation.date, fill.date);
  if (days == null) return null;
  return { priceGap, dollars: Math.round(worse * shares * 100) / 100, days };
}

export function hitRateBy(recommendations: LoggedRecommendation[], key: "rule" | "theme"): { name: string; hits: number; resolved: number; rate: number | null }[] {
  const groups = new Map<string, { hits: number; resolved: number }>();
  for (const row of recommendations) {
    if (row.outcome == null) continue;
    const name = row[key] || "unset";
    const group = groups.get(name) ?? { hits: 0, resolved: 0 };
    group.resolved += 1;
    if (row.outcome === 1) group.hits += 1;
    groups.set(name, group);
  }
  return [...groups.entries()].map(([name, group]) => ({
    name,
    hits: group.hits,
    resolved: group.resolved,
    rate: group.resolved ? group.hits / group.resolved : null,
  }));
}

export interface AttributionRow {
  weight: number;
  positionReturn: number;
  benchmarkReturn: number;
  /** Return from the actual fill price. Null when the user has not recorded a fill. */
  fillReturn: number | null;
  /** Return from the recommendation's reference close. */
  referenceReturn: number | null;
}

/**
 * Selection is the equal-weight gap versus the benchmark.
 * Sizing is the extra gap from weights that are not equal.
 * Timing is the gap between the fill and the reference close. It stays null if any fill is missing.
 */
export function attributeReturns(rows: AttributionRow[]): { selection: number | null; sizing: number | null; timing: number | null } {
  if (rows.length === 0) return { selection: null, sizing: null, timing: null };
  const equal = 1 / rows.length;
  let selection = 0;
  let sizing = 0;
  let timing = 0;
  let timingKnown = true;
  for (const row of rows) {
    const gap = row.positionReturn - row.benchmarkReturn;
    selection += equal * gap;
    sizing += (row.weight - equal) * gap;
    if (row.fillReturn == null || row.referenceReturn == null) timingKnown = false;
    else timing += row.weight * (row.fillReturn - row.referenceReturn);
  }
  return { selection, sizing, timing: timingKnown ? timing : null };
}

export function scoreProbabilities(calls: ProbabilityCall[]): { brier: number | null; calibration: CalibrationRow[] } {
  return { brier: brierScore(calls), calibration: calibrationTable(calls) };
}

function calendarDays(from: string, to: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000);
}
