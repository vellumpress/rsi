import { addDays } from "./dates";
import { fitBuy, fitSell } from "./orders";
import { defaultThresholds, type RuleThresholds } from "./rulebook";
import type { DataBlock } from "./quotes";

/**
 * Playbook p.3. Every position, top to bottom. The first rule that fires is the action.
 * Circuit breaker is checked before any add. Thresholds come from the live rulebook
 * so a quarterly edit changes later runs and does not rewrite past ones.
 */
export const DRAWDOWN_FREEZE = defaultThresholds().drawdownFreeze;
export const GREED_ABOVE_SMA = defaultThresholds().greedAboveSma;
export const FEAR_BELOW_HIGH = defaultThresholds().fearBelowHigh;
export const OVERWEIGHT = defaultThresholds().overweight;
export const POSITION_CAP = defaultThresholds().positionCap;
/** p.3 trim band is 20–25%. v1.0 uses 20%, the smaller cut. */
export const TRIM_FRACTION = defaultThresholds().trimFraction;
export const TOP_DECILE = defaultThresholds().topDecile;
export const BOTTOM_QUARTILE = defaultThresholds().bottomQuartile;

export interface EngineMilestone {
  status: "pending" | "hit" | "missed";
  resolvedOn?: string | null;
}

export interface EnginePosition {
  id: string;
  ticker: string;
  sleeve: "core" | "conviction" | "other";
  /** Core is deployed by the calendar. Fear and confirmation adds do not apply. */
  engineAdds: boolean;
  shares: number;
  marketValue: number | null;
  price: number | null;
  sma200: number | null;
  high52w: number | null;
  valuationPercentile: number | null;
  killConditionHit: boolean;
  milestones: EngineMilestone[];
  lastBuyDate: string | null;
  tranche1Deployed: boolean;
  tranche2Deployed: boolean;
  tranche3Deployed: boolean;
  trancheDollars: number;
  earmarkedCash: number;
  /** ISO date of the latest extra fear add, if any. */
  lastFearAddDate: string | null;
  /** Missing means the quote was accepted. stale/invalid/missing block every buy and sell. */
  dataBlock?: DataBlock;
}

export interface EngineBook {
  bookValue: number | null;
  peakValue: number | null;
  dryPowder: number;
  /** Friday official sweep. Extra dry-powder fear adds wait for this. */
  fridaySweep: boolean;
  today: string;
  positions: EnginePosition[];
  /** Live rulebook. Omitted in tests that exercise the v1.0 rails. */
  rules?: RuleThresholds;
}

export interface SignalSnapshot {
  kill: boolean;
  missedCount: number;
  extremeGreed: boolean;
  greedPrice: boolean;
  greedValuation: boolean;
  overweight: boolean;
  weight: number | null;
  extremeFear: boolean;
  fearBelowHigh: boolean;
  fearBelowSma: boolean;
  fearValuation: boolean;
  milestonesIntact: boolean;
  confirmedSinceBuy: boolean;
  priceMissing: boolean;
  valuationMissing: boolean;
}

export interface EngineAction {
  positionId: string;
  ticker: string;
  rule: "CB" | "R1" | "R2" | "R3" | "R4" | "R5" | "HOLD";
  side: "buy" | "sell" | "hold" | "freeze";
  dollars: number | null;
  shares: number | null;
  fromEarmarked: number;
  fromDry: number;
  reason: string;
  signals: SignalSnapshot;
}

export interface EngineResult {
  circuitBreaker: boolean;
  circuitBreakerEvaluated: boolean;
  bookValue: number | null;
  peakValue: number | null;
  drawdown: number | null;
  actions: EngineAction[];
  notes: string[];
}

function signalsOf(position: EnginePosition, bookValue: number | null, rules: RuleThresholds): SignalSnapshot {
  const missedCount = position.milestones.filter((milestone) => milestone.status === "missed").length;
  const historyOk = (position.dataBlock ?? "ok") === "ok";
  const greedPrice =
    historyOk &&
    position.price != null &&
    position.sma200 != null &&
    position.sma200 > 0 &&
    position.price >= position.sma200 * (1 + rules.greedAboveSma);
  const greedValuation = position.valuationPercentile != null && position.valuationPercentile >= rules.topDecile;
  const weight = position.marketValue != null && bookValue != null && bookValue > 0 ? position.marketValue / bookValue : null;
  const fearBelowHigh =
    historyOk &&
    position.price != null &&
    position.high52w != null &&
    position.high52w > 0 &&
    position.price <= position.high52w * (1 - rules.fearBelowHigh);
  const fearBelowSma = historyOk && position.price != null && position.sma200 != null && position.sma200 > 0 && position.price < position.sma200;
  const fearValuation = position.valuationPercentile != null && position.valuationPercentile <= rules.bottomQuartile;
  const milestonesIntact = position.milestones.length > 0 && missedCount === 0;
  const confirmedSinceBuy = position.milestones.some(
    (milestone) =>
      milestone.status === "hit" &&
      milestone.resolvedOn != null &&
      position.lastBuyDate != null &&
      milestone.resolvedOn > position.lastBuyDate,
  );
  return {
    kill: position.killConditionHit || missedCount >= 2,
    missedCount,
    extremeGreed: greedPrice || greedValuation,
    greedPrice,
    greedValuation,
    overweight: weight != null && weight > rules.overweight,
    weight,
    extremeFear: fearBelowHigh && fearBelowSma && fearValuation && milestonesIntact,
    fearBelowHigh,
    fearBelowSma,
    fearValuation,
    milestonesIntact,
    confirmedSinceBuy,
    priceMissing: position.price == null,
    valuationMissing: position.valuationPercentile == null,
  };
}

export function runEngine(book: EngineBook): EngineResult {
  const rules = book.rules ?? defaultThresholds();
  const notes: string[] = [];
  let circuitBreaker = false;
  let circuitBreakerEvaluated = false;
  let drawdown: number | null = null;

  if (book.bookValue == null || book.peakValue == null || book.peakValue <= 0) {
    notes.push("Circuit breaker was not evaluated. Book value or its peak is incomplete, and no drawdown is invented.");
  } else {
    circuitBreakerEvaluated = true;
    drawdown = (book.peakValue - book.bookValue) / book.peakValue;
    // p.3 circuit breaker. Exactly 30% down freezes adds. Exits and trims still run.
    circuitBreaker = drawdown + 1e-12 >= rules.drawdownFreeze;
    if (circuitBreaker) {
      notes.push("Circuit breaker is on. The book is down 30% or more from its peak. Every add is frozen. Exits and trims still run. Review the whole desk before any new buy.");
    }
  }

  let dry = Math.max(0, book.dryPowder);
  const actions: EngineAction[] = [];

  for (const position of book.positions) {
    if (position.shares <= 0 && !position.killConditionHit) continue;
    const signals = signalsOf(position, book.bookValue, rules);
    const base = { positionId: position.id, ticker: position.ticker, signals, fromEarmarked: 0, fromDry: 0 };
    const block = position.dataBlock ?? "ok";
    // Stale, invalid, or missing quotes cannot size a buy or a sell. p.3 is not run on invented prices.
    if (block === "stale" || block === "invalid" || block === "missing") {
      actions.push({
        ...base,
        rule: signals.kill ? "R1" : "HOLD",
        side: "hold",
        dollars: 0,
        shares: null,
        reason: "Insufficient data, no action. The quote failed a sanity check, so no order is sized.",
      });
      continue;
    }

    if (signals.kill) {
      // p.3 R1 and p.1 rule 02. Only the kill, including a second milestone miss, exits 100%.
      const exit = fitSell({
        desiredDollars: position.marketValue ?? 0,
        price: position.price,
        heldShares: position.shares,
        marketValue: position.marketValue,
        allowFullExit: true,
      });
      if (position.shares <= 0 || !exit.ok) {
        actions.push({
          ...base,
          rule: "R1",
          side: "freeze",
          dollars: 0,
          shares: null,
          reason: position.shares <= 0
            ? "Kill condition is met and there is no position to sell. Do not open or add. Write the post-mortem within 7 days."
            : "Insufficient data, no action. The kill is noted, but the exit is not sized.",
        });
      } else {
        actions.push({
          ...base,
          rule: "R1",
          side: "sell",
          dollars: exit.dollars,
          shares: exit.shares,
          reason: position.killConditionHit
            ? "Kill condition hit. Exit 100%. Cash goes to dry powder (T-bills). Post-mortem within 7 days."
            : "Second milestone miss counts as a kill. Exit 100%. Cash goes to dry powder (T-bills). Post-mortem within 7 days.",
        });
      }
      continue;
    }

    if (signals.extremeGreed || signals.overweight) {
      // p.3 R2. Overweight cuts back to 15%. Otherwise trim the rulebook fraction. Never a full exit.
      if (position.marketValue == null || position.price == null || (signals.overweight && book.bookValue == null && !signals.extremeGreed)) {
        actions.push({
          ...base,
          rule: "HOLD",
          side: "hold",
          dollars: 0,
          shares: null,
          reason: "Insufficient data, no action. The trim is not sized without a price and a book value.",
        });
        continue;
      }
      const desired = signals.overweight && book.bookValue != null
        ? position.marketValue - rules.positionCap * book.bookValue
        : position.marketValue * rules.trimFraction;
      const why = signals.overweight && book.bookValue != null
        ? `Position is overweight at ${((signals.weight ?? 0) * 100).toFixed(1)}% of the book, above 20%. Trim back to 15% of the book.`
        : `Extreme greed. Trim ${Math.round(rules.trimFraction * 100)}% of the position (inside the 20–25% band).`;
      const sell = fitSell({
        desiredDollars: desired,
        price: position.price,
        heldShares: position.shares,
        marketValue: position.marketValue,
        allowFullExit: false,
      });
      if (!sell.ok) {
        actions.push({ ...base, rule: "HOLD", side: "hold", dollars: 0, shares: null, reason: `Insufficient data, no action. ${sell.reason}` });
        continue;
      }
      actions.push({
        ...base,
        rule: "R2",
        side: "sell",
        dollars: sell.dollars,
        shares: sell.shares,
        reason: `${why} Proceeds go to dry powder. This is never a full exit.`,
      });
      continue;
    }

    if (signals.missedCount === 1) {
      actions.push({
        ...base,
        rule: "R3",
        side: "freeze",
        dollars: 0,
        shares: null,
        reason: "A milestone was missed. Freeze adds. Never average down on a missed milestone. Red Team re-reviews within two weeks. A second miss is a kill.",
      });
      continue;
    }

    if (signals.extremeFear) {
      const blocked = blockedAdd(base, circuitBreaker, "R4", "Extreme fear is present, but the circuit breaker freezes every add.");
      if (blocked) {
        actions.push(blocked);
        continue;
      }
      const buy = sizeAdd(position, book, dry, "R4", rules);
      if (buy.consumesDry) dry -= buy.consumesDry;
      actions.push({ ...base, ...buy.action });
      continue;
    }

    if (signals.confirmedSinceBuy && !position.tranche3Deployed && position.engineAdds) {
      const blocked = blockedAdd(
        base,
        circuitBreaker,
        "R5",
        "A milestone was confirmed since the last buy, but the circuit breaker freezes every add.",
      );
      if (blocked) {
        actions.push(blocked);
        continue;
      }
      if (!position.tranche1Deployed) {
        actions.push({
          ...base,
          rule: "HOLD",
          side: "hold",
          dollars: 0,
          shares: null,
          reason: "A milestone is confirmed, but the entry tranche is not on. The calendar deploys tranche 1. The engine does not skip ahead. Hold and log the check.",
        });
        continue;
      }
      const buy = sizeAdd(position, book, dry, "R5", rules);
      if (buy.consumesDry) dry -= buy.consumesDry;
      actions.push({ ...base, ...buy.action });
      continue;
    }

    actions.push({
      ...base,
      rule: "HOLD",
      side: "hold",
      dollars: 0,
      shares: null,
      reason: holdReason(position, signals),
    });
  }

  return {
    circuitBreaker,
    circuitBreakerEvaluated,
    bookValue: book.bookValue,
    peakValue: book.peakValue,
    drawdown,
    actions,
    notes,
  };
}

function blockedAdd(
  base: { positionId: string; ticker: string; signals: SignalSnapshot },
  circuitBreaker: boolean,
  _rule: "R4" | "R5",
  reason: string,
): EngineAction | null {
  if (!circuitBreaker) return null;
  return {
    ...base,
    rule: "CB",
    side: "freeze",
    dollars: 0,
    shares: null,
    fromEarmarked: 0,
    fromDry: 0,
    reason,
  };
}

function sizeAdd(
  position: EnginePosition,
  book: EngineBook,
  dry: number,
  rule: "R4" | "R5",
  rules: RuleThresholds,
): { action: Omit<EngineAction, "positionId" | "ticker" | "signals">; consumesDry: number } {
  const fearExtra = rule === "R4" && position.tranche2Deployed;
  const label =
    rule === "R5"
      ? "Confirmation tranche (tranche 3). Confirmation means reported numbers, not guidance."
      : fearExtra
        ? "Extreme fear with the fear tranche already used. Add once from dry powder."
        : "Extreme fear with milestones intact. Buy the fear tranche (tranche 2).";

  if (!position.engineAdds) {
    return {
      consumesDry: 0,
      action: {
        rule: "HOLD",
        side: "hold",
        dollars: 0,
        shares: null,
        fromEarmarked: 0,
        fromDry: 0,
        reason: "Core is bought on the calendar (three monthly tranches), not by the fear or confirmation rules. Hold and log the check.",
      },
    };
  }

  if (!position.tranche1Deployed) {
    return {
      consumesDry: 0,
      action: {
        rule: "HOLD",
        side: "hold",
        dollars: 0,
        shares: null,
        fromEarmarked: 0,
        fromDry: 0,
        reason: `${label} The entry tranche is not on yet, so the engine will not skip ahead. Hold and log the check.`,
      },
    };
  }

  if (fearExtra) {
    const recent =
      position.lastFearAddDate != null && book.today < addDays(position.lastFearAddDate, 7);
    if (!book.fridaySweep || recent) {
      return {
        consumesDry: 0,
        action: {
          rule: "HOLD",
          side: "hold",
          dollars: 0,
          shares: null,
          fromEarmarked: 0,
          fromDry: 0,
          reason: recent
            ? "Extreme fear persists, but an extra dry-powder add was already taken in the last 7 days. Hold and log the check."
            : "Extreme fear persists and the fear tranche is already invested. Extra dry-powder adds run on the Friday sweep only. Hold and log the check.",
        },
      };
    }
  }

  const useEarmarked = !fearExtra;
  const fit = fitBuy({
    desiredDollars: position.trancheDollars,
    price: position.price,
    earmarked: useEarmarked ? position.earmarkedCash : 0,
    dry,
    marketValue: position.marketValue,
    bookValue: book.bookValue,
    positionCap: rules.positionCap,
    useEarmarked,
  });
  if (!fit.ok) {
    return {
      consumesDry: 0,
      action: {
        rule: "HOLD",
        side: "hold",
        dollars: 0,
        shares: null,
        fromEarmarked: 0,
        fromDry: 0,
        reason: `${label} ${fit.reason}`,
      },
    };
  }
  const funding =
    fit.fromEarmarked > 0 && fit.fromDry > 0
      ? `Funded with ${fmt(fit.fromEarmarked)} of earmarked T-bills and ${fmt(fit.fromDry)} of dry powder.`
      : fit.fromEarmarked > 0
        ? `Funded with ${fmt(fit.fromEarmarked)} of earmarked T-bills.`
        : `Funded with ${fmt(fit.fromDry)} of dry powder.`;
  return {
    consumesDry: fit.fromDry,
    action: {
      rule,
      side: "buy",
      dollars: fit.dollars,
      shares: fit.shares,
      fromEarmarked: fit.fromEarmarked,
      fromDry: fit.fromDry,
      reason: `${label} ${funding} Cap: the position stays at or under 15% of the book.`,
    },
  };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function holdReason(position: EnginePosition, signals: SignalSnapshot): string {
  const parts = ["Hold. Checked the stack and logged it."];
  if (signals.priceMissing) parts.push("Price is missing, so price signals were skipped.");
  else if (position.sma200 != null && position.price != null && position.sma200 > 0) {
    const gap = position.price / position.sma200 - 1;
    parts.push(`Price is ${(gap * 100).toFixed(1)}% versus its 200-day average.`);
  }
  if (signals.valuationMissing) parts.push("Valuation percentile is blank, so the top-decile and bottom-quartile tests cannot fire.");
  else parts.push(`Valuation percentile is ${position.valuationPercentile}.`);
  if (signals.weight != null) parts.push(`Weight is ${(signals.weight * 100).toFixed(1)}% of the book.`);
  if (!signals.confirmedSinceBuy) parts.push("No milestone has been confirmed since the last buy.");
  if (!signals.extremeFear) parts.push("Extreme fear needs all three: 30% or more below the 52-week high, below the 200-day average, and a bottom-quartile valuation, with milestones intact.");
  return parts.join(" ");
}
