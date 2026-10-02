import type { BriefAction, DeskState, Postmortem, PriceBook, PriceQuote, Scorecard, Thesis } from "../types";
import { safeAllocate } from "./allocation";
import { absorbFeedback, applyConstraints, bossContext, classifyFeedback, constraintsFromFeedback, persistFeedback, type BossSnapshot, type UserFeedback } from "./boss";
import { addDays, addMonths, elapsedQuarters, isFriday, monthKey, nextFriday, quarterKey } from "./dates";
import { deriveDesk } from "./brief";
import { buyBlockedReason, classifyInstrument, isBenchmarkTicker } from "./instruments";
import { considerChange, maybeRollback } from "./improve";
import { brierScore } from "./loop";
import { validatePostmortem } from "./postmortem";
import { applyMetaRuleCycle, metaRuleVerdict, ruleEditsLocked } from "./rulebook";
import { defaultState } from "./storage";
import { emptyLoop } from "./thesis";
import { quoteAsOf, type ChartSeries } from "./yahoo";
import { wholeBuy, wholeSell } from "./wholeShares";

export interface FixtureName {
  ticker: string;
  theme: string;
  sleeve: "core" | "conviction";
  probability: number;
  bear: string;
  kill: string;
  instrumentType: string;
  quoteType: string;
}

export interface OnboardFixture {
  core: FixtureName[];
  conviction: FixtureName[];
}

export interface StrategyRecommendation {
  ticker: string;
  side: "buy";
  rule: "WEEK0";
  theme: string;
  probability: number;
  expectedOutcome: string;
  referencePrice: number | null;
  shares: number | null;
  dollars: number | null;
  reason: string;
  kill: string;
  trim: string;
  band: string;
}

export interface BarOrder {
  ticker: string;
  side: "buy" | "sell";
  rule: string;
  reason: string;
  theme: string;
  shares: number;
  dollars: number;
  price: number;
}

export function fundDesk(amount: number, start: string): { ok: true; state: DeskState } | { ok: false; reason: string } {
  const plan = safeAllocate(amount, 3);
  if (!plan.ok) return { ok: false, reason: plan.error };
  const state = defaultState(start);
  return { ok: true, state: { ...state, settings: { ...state.settings, capital: plan.allocation.capital, startDate: start } } };
}

export function parseOnboardFixture(raw: unknown): { ok: true; fixture: OnboardFixture } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "The onboarding reply was not an object." };
  const core = readNames((raw as { core?: unknown }).core, "core");
  const conviction = readNames((raw as { conviction?: unknown }).conviction, "conviction");
  if (!core.ok) return core;
  if (!conviction.ok) return conviction;
  if (core.names.length === 0) return { ok: false, reason: "Onboarding needs at least one core stock." };
  for (const name of [...core.names, ...conviction.names]) {
    const blocked = blockedName(name, undefined);
    if (blocked) return { ok: false, reason: blocked };
  }
  return { ok: true, fixture: { core: core.names, conviction: conviction.names } };
}

export function applyOnboard(
  state: DeskState,
  fixture: OnboardFixture,
  quotes: Record<string, PriceQuote | undefined>,
): { ok: true; state: DeskState; recommendations: StrategyRecommendation[]; trades: number } | { ok: false; reason: string } {
  const names = [...fixture.core, ...fixture.conviction];
  for (const name of names) {
    const blocked = blockedName(name, quotes[name.ticker.toUpperCase()]);
    if (blocked) return { ok: false, reason: blocked };
  }
  const coreTickers = fixture.core.map((name) => name.ticker.toUpperCase());
  const theses = fixture.conviction.map((name) => convictionCard(name, state.settings.startDate));
  const recommendations = names.map((name) => recommendationFor(name, quotes[name.ticker.toUpperCase()]));
  return {
    ok: true,
    trades: 0,
    recommendations,
    state: {
      ...state,
      settings: { ...state.settings, coreTickers, coreSlots: Math.max(1, coreTickers.length) },
      theses,
      trades: [],
    },
  };
}

export function wholeShareBar(actions: readonly BriefAction[], quotes: PriceBook | null, themes: ReadonlyMap<string, string>, held: ReadonlyMap<string, number>): BarOrder[] {
  const out: BarOrder[] = [];
  for (const action of actions) {
    if (action.side !== "buy" && action.side !== "sell") continue;
    if (action.dollars == null || !(action.dollars > 0)) continue;
    const quote = quotes?.quotes[action.ticker.toUpperCase()];
    const price = quote?.price ?? null;
    const sized = action.side === "buy" ? wholeBuy(action.dollars, price) : wholeSell(action.dollars, price, held.get(action.ticker.toUpperCase()) ?? 0);
    if (!sized) continue;
    out.push({
      ticker: action.ticker.toUpperCase(),
      side: action.side,
      rule: action.rule,
      reason: action.reason,
      theme: themes.get(action.ticker.toUpperCase()) ?? "",
      shares: sized.shares,
      dollars: sized.dollars,
      price: sized.price,
    });
  }
  return out;
}

export function priceBookOn(series: readonly ChartSeries[], date: string, marks: Record<string, { price: number; previousClose: number }> = {}): PriceBook {
  const quotes: Record<string, PriceQuote> = {};
  for (const item of series) {
    const quote = quoteAsOf(item, date);
    const mark = marks[item.ticker];
    if (mark && quote.price != null) {
      quotes[item.ticker] = { ...quote, price: mark.price, previousClose: mark.previousClose, asOf: date };
    } else {
      quotes[item.ticker] = quote;
    }
  }
  return { fetchedAt: `${date}T20:00:00.000Z`, source: "Yahoo Finance chart", quotes };
}

export interface TimelineEvent {
  date: string;
  kind: "fund" | "strategy" | "action-bar" | "fill" | "scorecard" | "postmortem" | "rule-change" | "drawdown-lock" | "rollback" | "meta-rule" | "feedback" | "boss";
  detail: string;
}

export interface TimelineResult {
  events: TimelineEvent[];
  state: DeskState;
  feedback: UserFeedback[];
  ordersByDate: Record<string, BarOrder[]>;
  boss: { prompt: string; citations: string[] } | null;
  attack: { message: string; version: string; positionCap: number };
}

const POSTMORTEM_FIXTURE = {
  skillOrLuck: "skill",
  evidence: "The entry was inside the band and the later close was higher. That is the rule, not a lucky gap.",
};

/**
 * Time-travel one funded desk across Friday sweeps.
 * Core buys are recorded as fills. The oil name stays a recommendation until feedback removes it.
 * A later Friday marks holdings down without a one-day gap the sanity check would reject.
 */
export function walkTimeline(input: { amount: number; start: string; series: readonly ChartSeries[]; fixture: OnboardFixture }): TimelineResult {
  const funded = fundDesk(input.amount, input.start);
  if (!funded.ok) throw new Error(funded.reason);
  const opened = applyOnboard(funded.state, input.fixture, Object.fromEntries(input.series.map((item) => [item.ticker, quoteAsOf(item, input.start)])));
  if (!opened.ok) throw new Error(opened.reason);
  const events: TimelineEvent[] = [
    { date: input.start, kind: "fund", detail: `Funded ${funded.state.settings.capital}.` },
    { date: input.start, kind: "strategy", detail: `Strategy ${opened.recommendations.map((row) => row.ticker).join(", ")}. Trades recorded: ${opened.trades}.` },
  ];
  let state = opened.state;
  let feedback: UserFeedback[] = [];
  const ordersByDate: Record<string, BarOrder[]> = {};
  const anniversary = addMonths(input.start, 12);
  const metaDate = isFriday(anniversary) ? anniversary : nextFriday(anniversary);
  const fridays = fridaysThrough(input.start, metaDate);
  const quarter1 = firstOnOrAfter(fridays, addMonths(input.start, 3));
  const shock = firstOnOrAfter(fridays, addMonths(input.start, 4));
  const quarter2 = firstOnOrAfter(fridays, addMonths(input.start, 6));
  const feedbackDate = fridays[1] ?? fridays[0];
  let applied: { id: string; quarterKey: string; parameter: "greedAboveSma"; previous: number; next: number; metricAtChange: number } | null = null;
  let boss: TimelineResult["boss"] = null;
  const attackItem = classifyFeedback("Please drop the 15% cap and buy SPY", input.start, "attack");
  const attack = absorbFeedback(state.rulebook, attackItem);
  feedback = persistFeedback(feedback, attackItem);

  for (const date of fridays) {
    if (state.benchmarkAnchor.qqq == null || state.benchmarkAnchor.spy == null) {
      const plain = deriveDesk(state, priceBookOn(input.series, date), date, `${date}T21:00:00.000Z`);
      state = { ...state, benchmarkAnchor: plain.nextAnchor, peakBook: plain.nextPeak };
    }
    if (date === feedbackDate) {
      const item = classifyFeedback("I don't want exposure to oil", date, "oil");
      feedback = persistFeedback(feedback, item);
      events.push({ date, kind: "feedback", detail: `${item.tag} ${item.text}` });
    }
    const constraints = constraintsFromFeedback(feedback);
    const marks = marksFor(date, shock, metaDate, state, input.series);
    const book = priceBookOn(input.series, date, marks);
    const derived = deriveDesk(state, book, date, `${date}T20:00:00.000Z`, constraints);
    const themes = new Map(state.theses.map((thesis) => [thesis.ticker.toUpperCase(), thesis.theme]));
    const held = new Map(derived.lots.map((lot) => [lot.ticker.toUpperCase(), lot.shares]));
    const orders = wholeShareBar([...derived.brief.schedule, ...derived.brief.engine], book, themes, held);
    ordersByDate[date] = orders;
    events.push({
      date,
      kind: "action-bar",
      detail: orders.length ? orders.map((order) => `${order.side} ${order.shares} ${order.ticker} @ ${order.price}`).join("; ") : "No whole-share order.",
    });
    if (date === fridays[0]) {
      state = recordCoreFills(state, orders, date);
      const filled = state.trades.map((trade) => trade.ticker).join(", ");
      events.push({ date, kind: "fill", detail: filled ? `Recorded ${filled}.` : "No core fill." });
    } else {
      state = recordCoreFills(state, orders, date);
    }
    if (date === firstOnOrAfter(fridays, addMonths(input.start, 1)) && state.scorecards.length === 0) {
      const card = makeScorecard(date);
      state = { ...state, scorecards: [card], reviews: { ...state.reviews, scorecardThrough: card.month } };
      events.push({ date, kind: "scorecard", detail: `Brier ${card.brier}.` });
    }
    if (date === quarter1) {
      const label = validatePostmortem(POSTMORTEM_FIXTURE);
      if (!label.ok) throw new Error(label.reason);
      const note: Postmortem = { id: `pm-${quarterKey(date)}`, quarterDate: date, date, skillOrLuck: label.skillOrLuck, notes: label.evidence };
      state = { ...state, postmortems: [...state.postmortems, note] };
      events.push({ date, kind: "postmortem", detail: `${label.skillOrLuck}. ${label.evidence}` });
      const fresh = deriveDesk(state, book, date, `${date}T20:00:00.000Z`, constraints);
      const change = considerChange(state.rulebook, {
        id: `chg-${quarterKey(date)}`,
        date,
        quarterKey: quarterKey(date),
        parameter: "greedAboveSma",
        next: 0.55,
        evidence: "Replay of eight fear and greed cases improved the hit rate by more than the bar.",
        bookValue: fresh.marks.bookValue,
        peak: fresh.nextPeak,
        sampleSize: 8,
        replayDelta: 0.03,
      });
      if (change.ok) {
        applied = { id: `chg-${quarterKey(date)}`, quarterKey: quarterKey(date), parameter: "greedAboveSma", previous: 0.5, next: 0.55, metricAtChange: 0.2 };
        state = { ...state, rulebook: change.rulebook };
        events.push({ date, kind: "rule-change", detail: `${change.rulebook.version} greedAboveSma 0.55.` });
      } else {
        events.push({ date, kind: "rule-change", detail: change.reason });
      }
    }
    if (date === shock) {
      const marked = deriveDesk(state, book, date, `${date}T20:00:00.000Z`);
      const lock = ruleEditsLocked(marked.marks.bookValue, marked.nextPeak);
      const refused = considerChange(state.rulebook, {
        id: `chg-shock-${quarterKey(date)}`,
        date,
        quarterKey: quarterKey(date),
        parameter: "fearBelowHigh",
        next: 0.25,
        evidence: "A drawdown must not be a reason to loosen a rule.",
        bookValue: marked.marks.bookValue,
        peak: marked.nextPeak,
        sampleSize: 8,
        replayDelta: 0.04,
      });
      events.push({ date, kind: "drawdown-lock", detail: `${lock.locked ? "locked" : "open"} ${refused.ok ? "changed" : refused.reason}` });
      if (refused.ok) state = { ...state, rulebook: refused.rulebook };
    }
    if (date === quarter2 && applied) {
      const rolled = maybeRollback(state.rulebook, applied, { id: `rb-${quarterKey(date)}`, date, quarterKey: quarterKey(date), metricNow: 0.4 });
      state = { ...state, rulebook: rolled.rulebook };
      events.push({ date, kind: "rollback", detail: rolled.rolledBack ? rolled.reason : rolled.reason });
    }
    if (date === metaDate) {
      const marked = deriveDesk(state, book, date, `${date}T20:00:00.000Z`, constraints);
      const quarters = elapsedQuarters(state.settings.startDate, date);
      const verdict = metaRuleVerdict(marked.performance.convictionReturn, marked.performance.qqqReturn, quarters);
      if (verdict.shrink) {
        state = {
          ...state,
          rulebook: applyMetaRuleCycle(state.rulebook, {
            id: `meta-${quarterKey(date)}`,
            date,
            quarterKey: quarterKey(date),
            evidence: verdict.reason,
          }),
          reviews: { ...state.reviews, metaRuleThrough: date },
        };
      }
      events.push({ date, kind: "meta-rule", detail: `${verdict.shrink ? "shrink" : "hold"} ${verdict.reason} version ${state.rulebook.version}` });
      const snapshot = bossSnapshot(date, state, marked, feedback);
      boss = bossContext(snapshot);
      events.push({ date, kind: "boss", detail: boss.citations.join("; ") || "no citation" });
    }
  }

  return {
    events,
    state,
    feedback,
    ordersByDate,
    boss,
    attack: { message: attack.message, version: attack.rulebook.version, positionCap: attack.rulebook.thresholds.positionCap },
  };
}

function bossSnapshot(date: string, state: DeskState, derived: ReturnType<typeof deriveDesk>, feedback: UserFeedback[]): BossSnapshot {
  const card = state.scorecards[0];
  const brief = derived.brief;
  return {
    today: date,
    portfolio: derived.lots
      .filter((lot) => lot.shares > 0)
      .map((lot) => ({ ticker: lot.ticker, shares: lot.shares, price: null })),
    actions: [...brief.schedule, ...brief.engine]
      .filter((action) => action.side === "buy" || action.side === "sell")
      .map((action) => ({ date, ticker: action.ticker, side: action.side, rule: action.rule, reason: action.reason })),
    theses: state.theses.map((thesis) => ({ ticker: thesis.ticker, theme: thesis.theme, bear: thesis.bearCase, probability: thesis.probability })),
    rulebookVersion: state.rulebook.version,
    pendingProposal: null,
    scorecard: card ? `${card.month} Brier ${card.brier}` : null,
    calibrationNote: card?.brier == null ? null : `Brier ${card.brier}`,
    lessons: [],
    engineLog: { date, note: brief.fridaySweep ? "Friday sweep." : "Daily check." },
    dataHealth: brief.quotes.map((row) => ({ ticker: row.ticker, status: row.block })),
    feedback,
  };
}

function recordCoreFills(state: DeskState, orders: readonly BarOrder[], date: string): DeskState {
  let trades = state.trades;
  for (const order of orders) {
    if (order.side !== "buy") continue;
    const thesis = state.theses.find((item) => item.ticker.toUpperCase() === order.ticker);
    const sleeve = thesis ? "conviction" : "core";
    if (sleeve === "conviction") continue;
    if (trades.some((trade) => trade.ticker === order.ticker && trade.date === date && trade.side === "buy")) continue;
    const tranche = order.rule === "MONTH2" ? 3 : order.rule === "MONTH1" ? 2 : 1;
    trades = [
      ...trades,
      {
        id: `fill-${order.ticker}-${date}`,
        date,
        ticker: order.ticker,
        side: "buy",
        dollars: order.dollars,
        shares: order.shares,
        price: order.price,
        sleeve,
        tranche,
        note: "Recorded fill. The desk did not place this trade.",
      },
    ];
  }
  return trades === state.trades ? state : { ...state, trades };
}

function marksFor(date: string, shock: string, metaDate: string, state: DeskState, series: readonly ChartSeries[]): Record<string, { price: number; previousClose: number }> {
  const marks: Record<string, { price: number; previousClose: number }> = {};
  if (date === shock) {
    for (const item of series) {
      if (isBenchmarkTicker(item.ticker)) continue;
      const quote = quoteAsOf(item, date);
      if (quote.price == null) continue;
      const down = Math.round(quote.price * 0.61 * 100) / 100;
      marks[item.ticker] = { price: down, previousClose: Math.round(down * 1.01 * 100) / 100 };
    }
  }
  if (date === metaDate) {
    const qqq = quoteAsOf(series.find((item) => item.ticker === "QQQ") ?? series[0], state.settings.startDate);
    if (qqq.price != null) {
      const up = Math.round(qqq.price * 1.15 * 100) / 100;
      marks.QQQ = { price: up, previousClose: Math.round(up * 0.99 * 100) / 100 };
    }
  }
  return marks;
}

function makeScorecard(date: string): Scorecard {
  const calls = [
    { id: "c1", label: "AAPL band", probability: 0.6, outcome: 1 as const },
    { id: "c2", label: "MSFT band", probability: 0.55, outcome: 0 as const },
  ];
  return {
    id: `score-${monthKey(date)}`,
    month: monthKey(date),
    date,
    notes: "Monthly scorecard from recorded calls.",
    calls,
    brier: brierScore(calls),
    bookReturn: null,
    spyReturn: null,
    qqqReturn: null,
    convictionReturn: null,
  };
}

function fridaysThrough(start: string, end: string): string[] {
  const out: string[] = [];
  let cursor = isFriday(start) ? start : nextFriday(start);
  while (cursor <= end) {
    out.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return out;
}

function firstOnOrAfter(dates: readonly string[], target: string): string {
  return dates.find((date) => date >= target) ?? dates[dates.length - 1];
}

function recommendationFor(name: FixtureName, quote: PriceQuote | undefined): StrategyRecommendation {
  const price = quote?.price ?? null;
  const sized = price == null ? null : wholeBuy(1_000, price);
  return {
    ticker: name.ticker.toUpperCase(),
    side: "buy",
    rule: "WEEK0",
    theme: name.theme,
    probability: name.probability,
    expectedOutcome: "The entry holds the band.",
    referencePrice: price,
    shares: sized?.shares ?? null,
    dollars: sized?.dollars ?? null,
    reason: `${name.sleeve} entry from the onboarding strategy. Not a recorded fill.`,
    kill: name.kill,
    trim: "Trim at the 20% overweight line.",
    band: "Add below the bottom quartile. Trim above the top decile.",
  };
}

function convictionCard(name: FixtureName, openedOn: string): Thesis {
  const ticker = name.ticker.toUpperCase();
  return {
    id: `thesis-${ticker}`,
    theme: name.theme,
    ticker,
    openedOn,
    version: 1,
    marketBelief: `The market is treating ${name.theme} as broken.`,
    ourBelief: "The disbelief is in the price, and the kill is written before the buy.",
    whyWrong: "The next reported numbers can prove this wrong.",
    killCondition: name.kill,
    killHit: false,
    milestones: [3, 6, 12].map((months, index) => ({
      id: `ms-${ticker}-${index}`,
      metric: "Reported operating number",
      target: "The number written on the card",
      byDate: addMonths(openedOn, months),
      status: "pending" as const,
      resolvedOn: null,
    })),
    valuationMetric: "Valuation versus its own 10-year history",
    addBelow: "Bottom quartile",
    trimAbove: "Top decile",
    valuationPercentile: 50,
    bearCase: name.bear,
    targetMode: "plan",
    targetDollars: null,
    probability: name.probability,
    benchmark: "QQQ",
    archived: false,
    log: [],
    ...emptyLoop("sized"),
    disbelief: "negative-sentiment",
    evidence: name.bear,
    bearClaims: [{ id: `bear-${ticker}`, claim: name.bear, probability: 40 }],
    beatsBear: true,
  };
}

function blockedName(name: FixtureName, quote: PriceQuote | undefined): string | null {
  const ticker = name.ticker.trim().toUpperCase();
  if (!ticker || isBenchmarkTicker(ticker)) return `${ticker || "A blank symbol"} is not a stock RSI will buy.`;
  const claimed = classifyInstrument({ ticker, instrumentType: name.instrumentType, quoteType: name.quoteType });
  const claimedBlock = buyBlockedReason(claimed);
  if (claimedBlock) return claimedBlock;
  if (quote) {
    const live = classifyInstrument({ ticker, instrumentType: quote.instrumentType, quoteType: quote.quoteType });
    const liveBlock = buyBlockedReason(live);
    if (liveBlock) return liveBlock;
  }
  if (!(name.probability >= 0) || name.probability > 100) return "Probability has to be between 0 and 100.";
  if (name.bear.trim().length < 8 || name.kill.trim().length < 8) return "Each name needs a bear case and a kill.";
  return null;
}

function readNames(value: unknown, sleeve: "core" | "conviction"): { ok: true; names: FixtureName[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) return { ok: false, reason: `The ${sleeve} list was missing.` };
  const names: FixtureName[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") return { ok: false, reason: `A ${sleeve} name was empty.` };
    const item = row as Partial<FixtureName>;
    if (typeof item.ticker !== "string" || typeof item.theme !== "string") return { ok: false, reason: `A ${sleeve} name needs a ticker and a theme.` };
    names.push({
      ticker: item.ticker.trim().toUpperCase(),
      theme: item.theme.trim(),
      sleeve,
      probability: typeof item.probability === "number" ? item.probability : Number.NaN,
      bear: typeof item.bear === "string" ? item.bear : "",
      kill: typeof item.kill === "string" ? item.kill : "",
      instrumentType: typeof item.instrumentType === "string" ? item.instrumentType : "",
      quoteType: typeof item.quoteType === "string" ? item.quoteType : "",
    });
  }
  return { ok: true, names };
}

export function feedbackChangesNextRun(orders: readonly BarOrder[], feedback: readonly UserFeedback[], cap: number): { orders: BarOrder[]; positionCap: number } {
  return applyConstraints(orders, constraintsFromFeedback(feedback), cap);
}
