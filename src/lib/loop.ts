import { addMonths } from "./dates";
import { isBenchmarkTicker } from "./instruments";
import { fitBuy } from "./orders";

/**
 * Playbook p.2, the recursive loop. Steps are gates. A failed bear case archives the
 * idea until next quarter. A price outside the add band waits on the watchlist.
 * The loop does not skip the monthly scorecard or the quarterly post-mortem (steps 6 and 7).
 */

export type Disbelief = "negative-sentiment" | "low-valuation";

export interface BearClaim {
  id: string;
  claim: string;
  /** 0–100. Probability the claim is true, written before the buy. */
  probability: number;
}

export interface ProbabilityCall {
  id: string;
  /** 0–1. */
  probability: number;
  outcome: 0 | 1 | null;
}

export function scoutGate(input: { trend: string; ticker: string; disbelief: Disbelief | null; evidence: string }): { ok: boolean; reason: string } {
  // p.2 step 1. Both disbelief types are the ones the playbook names. Anything else is not a scout.
  if (!input.trend.trim()) return { ok: false, reason: "Name the trend." };
  if (!/^[A-Z0-9.-]{1,12}$/.test(input.ticker.trim().toUpperCase())) return { ok: false, reason: "Enter the ticker of one company, not a fund." };
  if (isBenchmarkTicker(input.ticker)) return { ok: false, reason: "SPY and QQQ are benchmarks. They are never a theme and never a buy." };
  if (input.disbelief !== "negative-sentiment" && input.disbelief !== "low-valuation") {
    return { ok: false, reason: "The scout is a trend the market disbelieves: improving fundamentals with negative sentiment, or a low valuation versus its own history." };
  }
  if (!input.evidence.trim()) return { ok: false, reason: "Write the evidence, not a slogan." };
  return { ok: true, reason: "Scout is complete. Open the thesis card." };
}

/**
 * p.2 step 3. The human answers whether the thesis beats the bear case.
 * NO archives it. A blank answer or an unpriced claim does not pass.
 */
export function bearGate(
  input: { beatsBear: boolean | null; claims: BearClaim[]; thesisProbability: number | null },
  today: string,
): { decision: "incomplete"; reason: string } | { decision: "archive"; revisitOn: string; reason: string } | { decision: "pass"; reason: string } {
  const priced = input.claims.filter((claim) => claim.claim.trim() && claim.probability >= 0 && claim.probability <= 100);
  if (input.beatsBear === false) {
    return {
      decision: "archive",
      revisitOn: addMonths(today, 3),
      reason: "The thesis does not beat the bear case. Archive it and revisit next quarter.",
    };
  }
  if (priced.length === 0) return { decision: "incomplete", reason: "The bear case needs at least one claim with a probability." };
  if (input.thesisProbability == null || input.thesisProbability < 0 || input.thesisProbability > 100) {
    return { decision: "incomplete", reason: "Write P(thesis) before judging the bear case. Every call carries a probability." };
  }
  if (input.beatsBear !== true) return { decision: "incomplete", reason: "Answer whether the thesis beats the bear case. There is no default yes." };
  return { decision: "pass", reason: "The thesis beat the bear case. Check the valuation band next." };
}

/**
 * p.2: price inside the valuation band, else watchlist and alert at the band edge.
 * Conservative reading: the entry band is "add below X". Above X stays on the watchlist.
 * A missing price does not sneak the idea through.
 */
export function bandGate(input: { price: number | null; addBelow: number | null; trimAbove: number | null; quoteOk: boolean }): {
  status: "unknown" | "outside" | "inside";
  alert: boolean;
  reason: string;
} {
  if (!input.quoteOk || input.price == null || !(input.price > 0)) {
    return { status: "unknown", alert: false, reason: "Insufficient data, no action. The band check needs a sane price." };
  }
  if (input.addBelow == null || !(input.addBelow > 0)) {
    return { status: "unknown", alert: false, reason: "Set the add-below price before this gate can open." };
  }
  const belowTrim = input.trimAbove == null || !(input.trimAbove > 0) || input.price < input.trimAbove;
  if (input.price <= input.addBelow && belowTrim) {
    return { status: "inside", alert: true, reason: "Price is inside the add band. Size and stage is open." };
  }
  const nearEdge = input.price > input.addBelow && input.price <= input.addBelow * 1.02;
  return {
    status: "outside",
    alert: nearEdge,
    reason: nearEdge
      ? "Watchlist. Price is at the band edge and has not entered it."
      : "Watchlist. Price is outside the add band. Alert again at the band edge.",
  };
}

/** p.2 step 4 and p.1: target at most 15% of book. Buy one third now. Later thirds wait for the engine. */
export function sizeTranche1(input: {
  targetDollars: number;
  capDollars: number;
  earmarked: number;
  price: number | null;
  marketValue: number | null;
  bookValue: number | null;
  alreadyDeployed: boolean;
}): { ok: boolean; dollars: number; shares: number; reason: string } {
  if (input.alreadyDeployed) return { ok: false, dollars: 0, shares: 0, reason: "Tranche 1 is already on. Tranches 2 and 3 come only from the execution engine." };
  const target = Math.min(Math.max(0, input.targetDollars), input.capDollars);
  if (!(target > 0)) return { ok: false, dollars: 0, shares: 0, reason: "The target is zero, so there is no entry tranche." };
  const tranche = target / 3;
  const fit = fitBuy({
    desiredDollars: tranche,
    price: input.price,
    earmarked: input.earmarked,
    dry: 0,
    marketValue: input.marketValue ?? 0,
    bookValue: input.bookValue,
    positionCap: input.bookValue && input.bookValue > 0 ? input.capDollars / input.bookValue : 0.15,
    useEarmarked: true,
  });
  return { ok: fit.ok, dollars: fit.dollars, shares: fit.shares, reason: fit.ok ? `Entry tranche. ${fit.reason}` : fit.reason };
}

/** p.2 step 6. Brier score over resolved calls only. Unresolved calls are not treated as misses. */
export function brierScore(calls: ProbabilityCall[]): number | null {
  const resolved = calls.filter((call) => call.outcome != null && call.probability >= 0 && call.probability <= 1);
  if (resolved.length === 0) return null;
  const total = resolved.reduce((sum, call) => sum + (call.probability - (call.outcome as number)) ** 2, 0);
  return total / resolved.length;
}

export interface CalibrationRow {
  lo: number;
  hi: number;
  count: number;
  meanProbability: number | null;
  hitRate: number | null;
}

/** p.2 step 6. Ten buckets. The top bucket includes probability 1. */
export function calibrationTable(calls: ProbabilityCall[]): CalibrationRow[] {
  const rows: CalibrationRow[] = [];
  for (let index = 0; index < 10; index += 1) {
    const lo = index / 10;
    const hi = (index + 1) / 10;
    const inBucket = calls.filter((call) => call.probability >= lo && (index === 9 ? call.probability <= hi : call.probability < hi));
    const resolved = inBucket.filter((call) => call.outcome != null);
    rows.push({
      lo,
      hi,
      count: resolved.length,
      meanProbability: resolved.length ? resolved.reduce((sum, call) => sum + call.probability, 0) / resolved.length : null,
      hitRate: resolved.length ? resolved.reduce((sum, call) => sum + (call.outcome as number), 0) / resolved.length : null,
    });
  }
  return rows;
}

/** p.1 rule 01. A missed milestone blocks every add, including a hand-entered one. */
export function averageDownBlocked(missedMilestones: number): boolean {
  return missedMilestones >= 1;
}

/** p.1 rule 02. Sentiment is not an exit. Kill (including a second miss) and rule 04 are. */
export function fullExitAllowed(reason: "kill" | "meta-rule" | "sentiment" | "trim"): boolean {
  return reason === "kill" || reason === "meta-rule";
}
