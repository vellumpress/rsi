import { weekdayUTC } from "./dates";
import { isBenchmarkTicker } from "./instruments";
import { isImmutable, POSITION_CAP, type IMMUTABLE } from "./improve";
import type { Lesson } from "./learning";
import type { Rulebook } from "./rulebook";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type FeedbackTag = "exclusion" | "pace" | "voice" | "risk" | "rule-change" | "note";

export interface ConstraintPatch {
  excludeTickers: string[];
  excludeThemes: string[];
  maxNewTrades: number | null;
  plainLanguage: boolean;
  /** Higher risk cannot loosen a cap. Lower risk may tighten one. */
  risk: "lower" | "higher" | null;
}

export interface UserFeedback {
  id: string;
  date: string;
  text: string;
  tag: FeedbackTag;
  constraint: ConstraintPatch | null;
}

export interface BossSnapshot {
  today: string;
  portfolio: { ticker: string; shares: number; price: number | null }[];
  actions: { date: string; ticker: string; side: string; rule: string; reason: string }[];
  theses: { ticker: string; theme: string; bear: string; probability: number | null }[];
  rulebookVersion: string;
  pendingProposal: string | null;
  scorecard: string | null;
  calibrationNote: string | null;
  lessons: Lesson[];
  engineLog: { date: string; note: string } | null;
  dataHealth: { ticker: string; status: string }[];
  feedback: UserFeedback[];
}

export function cite(source: string, iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return source;
  const [, month, day] = iso.split("-").map(Number);
  const label = `${DAYS[weekdayUTC(iso)]} ${MONTHS[month - 1]} ${day}`;
  return `${source}, ${label}`;
}

export function classifyFeedback(text: string, date: string, id: string): UserFeedback {
  const raw = text.trim();
  if (isRuleRequest(raw)) {
    return { id, date, text: raw, tag: "rule-change", constraint: null };
  }
  const exposure = phraseAfter(raw, ["exposure to", "avoid", "exclude"]);
  if (exposure) {
    const token = exposure.split(/\s+/)[0]?.replace(/[^A-Za-z]/g, "") ?? "";
    const ticker = token.length >= 1 && token.length <= 5 && token === token.toUpperCase() && /[A-Z]/.test(token);
    return {
      id,
      date,
      text: raw,
      tag: "exclusion",
      constraint: {
        excludeTickers: ticker ? [token] : [],
        excludeThemes: ticker ? [] : [exposure.toLowerCase()],
        maxNewTrades: null,
        plainLanguage: false,
        risk: null,
      },
    };
  }
  if (/too many trades|fewer trades|slow down the trades/i.test(raw)) {
    return { id, date, text: raw, tag: "pace", constraint: emptyConstraint({ maxNewTrades: 1 }) };
  }
  if (/explain more simply|plain language|simpler/i.test(raw)) {
    return { id, date, text: raw, tag: "voice", constraint: emptyConstraint({ plainLanguage: true }) };
  }
  if (/less risk|lower risk|too much risk/i.test(raw)) {
    return { id, date, text: raw, tag: "risk", constraint: emptyConstraint({ risk: "lower" }) };
  }
  if (/more risk|higher risk/i.test(raw)) {
    return { id, date, text: raw, tag: "risk", constraint: emptyConstraint({ risk: "higher" }) };
  }
  return { id, date, text: raw, tag: "note", constraint: null };
}

export function persistFeedback(existing: readonly UserFeedback[], item: UserFeedback): UserFeedback[] {
  if (existing.some((row) => row.id === item.id)) return [...existing];
  return [...existing, item];
}

export function constraintsFromFeedback(items: readonly UserFeedback[]): ConstraintPatch {
  const merged = emptyConstraint();
  for (const item of items) {
    if (!item.constraint) continue;
    merged.excludeTickers.push(...item.constraint.excludeTickers);
    merged.excludeThemes.push(...item.constraint.excludeThemes);
    if (item.constraint.maxNewTrades != null) {
      merged.maxNewTrades = merged.maxNewTrades == null ? item.constraint.maxNewTrades : Math.min(merged.maxNewTrades, item.constraint.maxNewTrades);
    }
    merged.plainLanguage = merged.plainLanguage || item.constraint.plainLanguage;
    if (item.constraint.risk === "lower") merged.risk = "lower";
    else if (item.constraint.risk === "higher" && merged.risk !== "lower") merged.risk = "higher";
  }
  merged.excludeTickers = [...new Set(merged.excludeTickers.map((ticker) => ticker.toUpperCase()))];
  merged.excludeThemes = [...new Set(merged.excludeThemes)];
  return merged;
}

export function applyConstraints<T extends { ticker: string; side: string; theme?: string }>(
  orders: readonly T[],
  constraints: ConstraintPatch,
  positionCap: number,
): { orders: T[]; positionCap: number } {
  const excluded = new Set(constraints.excludeTickers.map((ticker) => ticker.toUpperCase()));
  const themes = new Set(constraints.excludeThemes.map((theme) => theme.toLowerCase()));
  let next = orders.filter((order) => {
    if (isBenchmarkTicker(order.ticker)) return false;
    if (excluded.has(order.ticker.toUpperCase())) return false;
    if (order.theme && themes.has(order.theme.toLowerCase())) return false;
    return true;
  });
  if (constraints.maxNewTrades != null) {
    let buys = 0;
    next = next.filter((order) => {
      if (order.side !== "buy" && order.side !== "BUY") return true;
      buys += 1;
      return buys <= constraints.maxNewTrades!;
    });
  }
  const tightened = constraints.risk === "lower" ? Math.min(positionCap, 0.1) : positionCap;
  return { orders: next, positionCap: Math.min(POSITION_CAP, tightened) };
}

/** Feedback never edits the rulebook. A rule request is stored and deferred. */
export function absorbFeedback(rulebook: Rulebook, feedback: UserFeedback): { rulebook: Rulebook; message: string } {
  if (feedback.tag === "rule-change" || mentionsImmutable(feedback.text)) {
    return {
      rulebook,
      message: "That would change a rule. The Boss cannot do it now. One change is considered each quarter, only with evidence and a replay, and never in a 10% drawdown. The 15% cap, the 20% trim line, the 30% circuit breaker, stocks only, and the Four Rules are immutable.",
    };
  }
  if (feedback.constraint) {
    return { rulebook, message: "Stored. This preference applies on the next engine run. It does not place a trade and it does not change a rule." };
  }
  return { rulebook, message: "Stored in the learning notes. No rule was changed." };
}

export function bossContext(snapshot: BossSnapshot): { prompt: string; citations: string[] } {
  const citations: string[] = [];
  const lines = [
    "You are the Boss. You run this desk and you can see the state below. You answer in real time.",
    "You cannot place a trade, invent a price, or override an immutable rule.",
    "If the user asks to change a rule, say plainly that it waits for the quarterly review: one change, evidence, a replay, and no change in a 10% drawdown.",
    "Cite the source you used, in the form already written below.",
  ];
  if (snapshot.engineLog) {
    const label = cite("Engine log", snapshot.engineLog.date);
    citations.push(label);
    lines.push(`${label}: ${snapshot.engineLog.note}`);
  }
  if (snapshot.actions.length) {
    const label = cite("Today's actions", snapshot.actions[0].date);
    citations.push(label);
    lines.push(`${label}: ${snapshot.actions.map((action) => `${action.side} ${action.ticker} ${action.rule} — ${action.reason}`).join(" | ")}`);
  }
  lines.push(`Rulebook ${snapshot.rulebookVersion}. Pending proposal: ${snapshot.pendingProposal ?? "none"}.`);
  lines.push(`Scorecard: ${snapshot.scorecard ?? "none yet"}. Calibration: ${snapshot.calibrationNote ?? "none yet"}.`);
  lines.push(
    `Portfolio: ${
      snapshot.portfolio.length
        ? snapshot.portfolio.map((row) => `${row.ticker} ${row.shares} shares at ${row.price ?? "price unavailable"}`).join(" | ")
        : "no recorded positions"
    }.`,
  );
  lines.push(
    `Theses: ${
      snapshot.theses.length
        ? snapshot.theses.map((thesis) => `${thesis.ticker} ${thesis.theme} P ${thesis.probability ?? "unset"} bear: ${thesis.bear}`).join(" | ")
        : "none"
    }.`,
  );
  lines.push(
    `Data health: ${snapshot.dataHealth.length ? snapshot.dataHealth.map((row) => `${row.ticker} ${row.status}`).join(" | ") : "none"}. Say price unavailable. Do not invent one.`,
  );
  if (snapshot.lessons.length) lines.push(snapshot.lessons.map((lesson) => `Lesson ${lesson.date}: ${lesson.observation}`).join("\n"));
  if (snapshot.feedback.length) lines.push(`Stored feedback: ${snapshot.feedback.map((item) => `${item.date} ${item.tag}: ${item.text}`).join(" | ")}`);
  lines.push(`Immutable: ${( ["positionCap", "overweight", "drawdownFreeze", "stocksOnly", "fourRules"] as (typeof IMMUTABLE)[number][]).filter(isImmutable).join(", ")}.`);
  return { prompt: lines.join("\n"), citations };
}

function isRuleRequest(text: string): boolean {
  return /15%|position cap|circuit breaker|trim line|change the rule|drop the cap|buy spy|buy qqq|buy an etf|t-bill|ignore the four rules/i.test(text);
}

function mentionsImmutable(text: string): boolean {
  return isRuleRequest(text);
}

function phraseAfter(text: string, phrases: string[]): string | null {
  const lower = text.toLowerCase();
  for (const phrase of phrases) {
    const at = lower.indexOf(phrase);
    if (at < 0) continue;
    const rest = text.slice(at + phrase.length).trim().replace(/[.?!].*$/, "").trim();
    if (rest) return rest;
  }
  return null;
}

function emptyConstraint(patch: Partial<ConstraintPatch> = {}): ConstraintPatch {
  return {
    excludeTickers: patch.excludeTickers ?? [],
    excludeThemes: patch.excludeThemes ?? [],
    maxNewTrades: patch.maxNewTrades ?? null,
    plainLanguage: patch.plainLanguage ?? false,
    risk: patch.risk ?? null,
  };
}
