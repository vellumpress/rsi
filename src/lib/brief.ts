import type { BenchmarkAnchor, Brief, BriefAction, DeskState, PriceBook, QuoteStamp, Thesis } from "../types";
import { allocate, themeTarget, type Allocation } from "./allocation";
import { addMonths, elapsedMonthDates, isFriday, monthKey, prettyDate } from "./dates";
import { runEngine, type EngineAction, type EnginePosition } from "./engine";
import { buyBlockedReason, classifyInstrument, isBenchmarkTicker } from "./instruments";
import { cashBuckets, markBook, quoteFor, replayTrades, type CashBuckets, type MarkedBook, type PositionLot } from "./ledger";
import { cents, pct } from "./money";
import { applyConstraints, type ConstraintPatch } from "./boss";
import { assessQuote, type DataBlock } from "./quotes";
import { dueDeployment, scheduleRows, type ScheduleRow, type ThemeSchedule } from "./schedule";

export interface Performance {
  bookReturn: number | null;
  spyReturn: number | null;
  qqqReturn: number | null;
  convictionReturn: number | null;
  convictionValue: number | null;
  convictionBasis: number;
}

export interface Derived {
  alloc: Allocation;
  buckets: CashBuckets;
  marks: MarkedBook;
  lots: PositionLot[];
  schedule: ScheduleRow[];
  performance: Performance;
  brief: Brief;
  nextPeak: number;
  nextAnchor: BenchmarkAnchor;
}

export function deriveDesk(state: DeskState, prices: PriceBook | null, today: string, generatedAt = new Date().toISOString(), constraints?: ConstraintPatch): Derived {
  const alloc = allocate(state.settings.capital, state.settings.themeCount);
  const buckets = cashBuckets(state.settings, state.theses, state.trades);
  const marks = markBook(state.settings, state.theses, state.trades, prices);
  const lots = replayTrades(state.trades);
  const nextAnchor = mergeAnchor(state.benchmarkAnchor, prices, today);
  const nextPeak = Math.max(state.peakBook ?? state.settings.capital, state.settings.capital, marks.bookValue ?? 0);
  const performance = scorePerformance(state, alloc, buckets, marks, nextAnchor, prices);
  const themes = themeSchedules(state, alloc, lots);
  const schedule = scheduleRows({
    startDate: state.settings.startDate,
    today,
    alloc,
    coreTickers: state.settings.coreTickers,
    coreSlots: state.settings.coreSlots,
    coreBought: coreBought(state),
    themes,
    metaRuleDone: state.reviews.metaRuleThrough != null && state.reviews.metaRuleThrough >= addMonths(state.settings.startDate, 12),
  });
  const brief = assembleBrief({ state, prices, today, generatedAt, alloc, buckets, marks, lots, nextPeak, performance, themes, constraints });
  return { alloc, buckets, marks, lots, schedule, performance, brief, nextPeak, nextAnchor };
}

function coreBought(state: DeskState): number {
  return state.trades.filter((trade) => trade.sleeve === "core" && trade.side === "buy").reduce((sum, trade) => sum + trade.dollars, 0);
}

function coreBuysByTicker(state: DeskState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const trade of state.trades) {
    if (trade.sleeve !== "core" || trade.side !== "buy") continue;
    const ticker = trade.ticker.trim().toUpperCase();
    out[ticker] = (out[ticker] ?? 0) + trade.dollars;
  }
  return out;
}

function themeSchedules(state: DeskState, alloc: Allocation, lots: PositionLot[]): ThemeSchedule[] {
  return state.theses
    .filter((thesis) => !thesis.archived)
    .map((thesis) => {
      const target = themeTarget(alloc, thesis);
      const lot = lots.find((item) => item.thesisId === thesis.id);
      const misses = thesis.milestones.filter((milestone) => milestone.status === "missed").length;
      // p.2 step 4. Tranches 2 and 3 are engine-only. The calendar entry third waits until the gates pass.
      if (thesis.stage !== "approved" && thesis.stage !== "sized" && !lot?.tranche1) return null;
      return {
        id: thesis.id,
        ticker: thesis.ticker.trim().toUpperCase(),
        theme: thesis.theme.trim(),
        trancheDollars: target / 3,
        tranche1: lot?.tranche1 ?? false,
        blocked: thesis.killHit || misses >= 2,
      };
    })
    .filter((row): row is ThemeSchedule => row != null);
}

function mergeAnchor(current: BenchmarkAnchor, prices: PriceBook | null, today: string): BenchmarkAnchor {
  const spy = prices?.quotes.SPY?.price ?? null;
  const qqq = prices?.quotes.QQQ?.price ?? null;
  return {
    spy: current.spy ?? (spy != null ? { date: today, price: spy } : null),
    qqq: current.qqq ?? (qqq != null ? { date: today, price: qqq } : null),
  };
}

function scorePerformance(
  state: DeskState,
  alloc: Allocation,
  buckets: CashBuckets,
  marks: MarkedBook,
  anchor: BenchmarkAnchor,
  prices: PriceBook | null,
): Performance {
  const convictionPositions = marks.positions.filter((position) => position.sleeve === "conviction");
  const convictionKnown = convictionPositions.every((position) => position.marketValue != null);
  const invested = convictionKnown ? convictionPositions.reduce((sum, position) => sum + (position.marketValue ?? 0), 0) : null;
  const convictionValue = invested == null ? null : cents(invested + buckets.earmarkedTotal + buckets.unassignedConviction);
  const spyNow = prices?.quotes.SPY?.price ?? null;
  const qqqNow = prices?.quotes.QQQ?.price ?? null;
  return {
    bookReturn: marks.bookValue == null ? null : marks.bookValue / state.settings.capital - 1,
    spyReturn: anchor.spy && spyNow != null && anchor.spy.price > 0 ? spyNow / anchor.spy.price - 1 : null,
    qqqReturn: anchor.qqq && qqqNow != null && anchor.qqq.price > 0 ? qqqNow / anchor.qqq.price - 1 : null,
    convictionReturn: convictionValue == null || alloc.conviction <= 0 ? null : convictionValue / alloc.conviction - 1,
    convictionValue,
    convictionBasis: alloc.conviction,
  };
}

function assembleBrief(input: {
  state: DeskState;
  prices: PriceBook | null;
  today: string;
  generatedAt: string;
  alloc: Allocation;
  buckets: CashBuckets;
  marks: MarkedBook;
  lots: PositionLot[];
  nextPeak: number;
  performance: Performance;
  themes: ThemeSchedule[];
  constraints?: ConstraintPatch;
}): Brief {
  const { state, today, marks, buckets, alloc, performance } = input;
  const fridaySweep = isFriday(today);
  const dataGaps = [...marks.gaps];
  if (!input.prices || Object.keys(input.prices.quotes).length === 0) {
    dataGaps.unshift("No market snapshot is loaded. Price signals are skipped. Nothing below invents a price.");
  }
  for (const thesis of state.theses.filter((item) => !item.archived)) {
    const ticker = thesis.ticker.trim().toUpperCase();
    if (!ticker) {
      dataGaps.push(`${thesis.theme || "Untitled theme"} has no ticker, so it cannot be priced or traded from this brief.`);
      continue;
    }
    const quote = quoteFor(input.prices, ticker);
    if (!quote || quote.price == null) {
      dataGaps.push(`${ticker}: not in the price snapshot. Add it to config/watchlist.json so the daily job fetches it. Planned deployment dollars do not depend on a live price; engine sizing does.`);
    }
    if (thesis.valuationPercentile == null) {
      dataGaps.push(`${ticker}: valuation percentile is blank. Top-decile and bottom-quartile tests cannot fire until you enter it on the thesis card.`);
    }
  }

  const schedulePlanned = dueDeployment({
    startDate: state.settings.startDate,
    today,
    coreTickers: state.settings.coreTickers,
    coreSlots: state.settings.coreSlots,
    alloc,
    coreBoughtByTicker: coreBuysByTicker(state),
    themes: input.themes,
  });

  const engineBookPositions = enginePositions(state, input.lots, marks, buckets, alloc, input.prices, today);
  const liveCap = input.constraints
    ? applyConstraints([], input.constraints, state.rulebook.thresholds.positionCap).positionCap
    : state.rulebook.thresholds.positionCap;
  const engine = runEngine({
    bookValue: marks.bookValue,
    peakValue: marks.complete ? input.nextPeak : null,
    dryPowder: buckets.dryPowder,
    fridaySweep,
    today,
    positions: engineBookPositions,
    rules: { ...state.rulebook.thresholds, positionCap: liveCap },
  });

  const scheduled = engine.circuitBreaker ? schedulePlanned.map((action) => freezeScheduled(action, today)) : schedulePlanned;
  let schedule = scheduled.map((action) => gateScheduledQuote(action, input.prices, today));
  let engineActions = engine.actions.map((action, index) => toBriefAction(action, today, index, engineBookPositions));
  if (input.constraints) {
    const themeOf = new Map(state.theses.map((thesis) => [thesis.ticker.trim().toUpperCase(), thesis.theme]));
    const scheduleIds = new Set(schedule.map((action) => action.id));
    const tagged = (actions: BriefAction[]) => actions.map((action) => ({ ...action, theme: themeOf.get(action.ticker.trim().toUpperCase()) }));
    const filtered = applyConstraints([...tagged(schedule), ...tagged(engineActions)], input.constraints, liveCap).orders;
    schedule = filtered.filter((action) => scheduleIds.has(action.id));
    engineActions = filtered.filter((action) => !scheduleIds.has(action.id));
  }
  const quotes = quoteStamps(state, input.prices, today);

  const reminders = dueReminders(state, today, performance);
  reminders.push(...milestoneReminders(state, today));

  const notes = [...engine.notes];
  notes.unshift(
    fridaySweep
      ? "Friday full engine sweep. Circuit breaker first, then each open position top to bottom. The first rule that fires is the action."
      : "Daily price and signal check, using the same rules. The playbook runs the official full sweep on Fridays; this brief still flags a kill, trim, freeze, or add so it is not missed between sweeps.",
  );
  notes.unshift("Not financial advice. Verify before trading. These rows are suggestions. RSI does not place trades or connect to a brokerage.");
  if (schedule.some((action) => action.side === "buy")) {
    notes.push("Scheduled dollars are the deployment plan. Unspent theme thirds and dry powder stay in cash. Cash is carried at par. It is not invested in T-bills.");
  }
  if (buckets.overAllocated) {
    notes.push("Cash reservations exceed the cash on hand. Lower a theme target or record the trades you have already made before adding.");
  }
  if (today < state.settings.startDate) {
    notes.push(`Deployment has not started. Week 0 is ${prettyDate(state.settings.startDate)}.`);
  }

  return {
    id: `brief-${today}`,
    date: today,
    generatedAt: input.generatedAt,
    fridaySweep,
    circuitBreaker: engine.circuitBreaker,
    circuitBreakerEvaluated: engine.circuitBreakerEvaluated,
    bookValue: marks.bookValue,
    peak: input.nextPeak,
    drawdown: engine.drawdown,
    dataGaps: unique(dataGaps),
    schedule,
    engine: engineActions,
    reminders,
    notes,
    quotes,
  };
}

function enginePositions(
  state: DeskState,
  lots: PositionLot[],
  marks: MarkedBook,
  buckets: CashBuckets,
  alloc: Allocation,
  prices: PriceBook | null,
  today: string,
): EnginePosition[] {
  const positions: EnginePosition[] = [];
  const marked = new Map(marks.positions.map((position) => [position.id, position]));

  for (const lot of lots) {
    if (lot.shares <= 0 && lot.sleeve !== "conviction") continue;
    const mark = marked.get(lot.id);
    const thesis = lot.thesisId ? state.theses.find((item) => item.id === lot.thesisId) : undefined;
    if (lot.shares <= 0 && thesis && !thesis.killHit && thesis.milestones.filter((m) => m.status === "missed").length < 2) {
      continue;
    }
    positions.push(toEnginePosition(lot, mark, thesis, buckets, alloc, prices, today));
  }

  for (const thesis of state.theses) {
    if (thesis.archived) continue;
    const misses = thesis.milestones.filter((milestone) => milestone.status === "missed").length;
    if (!thesis.killHit && misses < 2) continue;
    if (lots.some((lot) => lot.thesisId === thesis.id)) continue;
    positions.push(
      toEnginePosition(
        {
          id: `thesis:${thesis.id}`,
          ticker: thesis.ticker.trim().toUpperCase() || "—",
          sleeve: "conviction",
          thesisId: thesis.id,
          shares: 0,
          costBasis: 0,
          lastBuyDate: null,
          tranche1: false,
          tranche2: false,
          tranche3: false,
          lastFearAddDate: null,
        },
        undefined,
        thesis,
        buckets,
        alloc,
        prices,
        today,
      ),
    );
  }

  positions.sort((a, b) => {
    if (a.sleeve === "core" && b.sleeve !== "core") return -1;
    if (b.sleeve === "core" && a.sleeve !== "core") return 1;
    return a.ticker.localeCompare(b.ticker);
  });
  return positions;
}

function toEnginePosition(
  lot: PositionLot,
  mark: MarkedBook["positions"][number] | undefined,
  thesis: Thesis | undefined,
  buckets: CashBuckets,
  alloc: Allocation,
  prices: PriceBook | null,
  today: string,
): EnginePosition {
  const target = thesis ? themeTarget(alloc, thesis) : alloc.coreTranche * 3;
  const earmarked = thesis ? (buckets.earmarked.find((row) => row.thesisId === thesis.id)?.dollars ?? 0) : 0;
  return {
    id: lot.id,
    ticker: (mark?.ticker || lot.ticker).toUpperCase(),
    sleeve: lot.sleeve,
    engineAdds: lot.sleeve === "conviction" && Boolean(thesis) && !thesis?.archived,
    shares: lot.shares,
    marketValue: mark?.marketValue ?? (lot.shares <= 0 ? 0 : null),
    price: mark?.price ?? null,
    sma200: mark?.sma200 ?? null,
    high52w: mark?.high52w ?? null,
    valuationPercentile: thesis?.valuationPercentile ?? null,
    killConditionHit: thesis?.killHit ?? false,
    milestones: (thesis?.milestones ?? []).map((milestone) => ({
      status: milestone.status,
      resolvedOn: milestone.resolvedOn,
      reported: milestone.reported === true,
    })),
    lastBuyDate: lot.lastBuyDate,
    tranche1Deployed: lot.tranche1,
    tranche2Deployed: lot.tranche2,
    tranche3Deployed: lot.tranche3,
    trancheDollars: target / 3,
    earmarkedCash: earmarked,
    lastFearAddDate: lot.lastFearAddDate,
    dataBlock: blockFor(prices, (mark?.ticker || lot.ticker || "").toUpperCase(), today),
    instrument: instrumentFor(prices, (mark?.ticker || lot.ticker || "").toUpperCase()),
  };
}

function blockFor(prices: PriceBook | null, ticker: string, today: string): DataBlock {
  const quote = quoteFor(prices, ticker);
  return assessQuote(
    quote
      ? { price: quote.price, previousClose: quote.previousClose, asOf: quote.asOf, bars: quote.bars }
      : undefined,
    today,
  ).block;
}

function instrumentFor(prices: PriceBook | null, ticker: string) {
  const quote = quoteFor(prices, ticker);
  return classifyInstrument({ ticker, instrumentType: quote?.instrumentType, quoteType: quote?.quoteType });
}

function gateScheduledQuote(action: BriefAction, prices: PriceBook | null, today: string): BriefAction {
  if (action.side !== "buy") return action;
  if (isBenchmarkTicker(action.ticker)) {
    return {
      ...action,
      side: "freeze",
      dollars: 0,
      shares: null,
      rule: "FUND",
      funding: undefined,
      record: undefined,
      reason: "SPY and QQQ are benchmarks. They are never a buy or a sell.",
    };
  }
  const blocked = buyBlockedReason(instrumentFor(prices, action.ticker));
  if (blocked) {
    return {
      ...action,
      side: "freeze",
      dollars: 0,
      shares: null,
      rule: "FUND",
      funding: undefined,
      record: undefined,
      reason: `${blocked} The scheduled buy is not sized.`,
    };
  }
  const check = assessQuote(
    (() => {
      const quote = quoteFor(prices, action.ticker);
      return quote ? { price: quote.price, previousClose: quote.previousClose, asOf: quote.asOf, bars: quote.bars } : undefined;
    })(),
    today,
  );
  // A short history can still fund a calendar buy. The price itself passed the sanity checks.
  if (check.block !== "stale" && check.block !== "invalid" && check.block !== "missing") return action;
  return {
    ...action,
    side: "freeze",
    dollars: 0,
    shares: null,
    rule: "DATA",
    funding: undefined,
    record: undefined,
    reason: `${check.message} The scheduled buy is not sized.`,
  };
}

function quoteStamps(state: DeskState, prices: PriceBook | null, today: string): QuoteStamp[] {
  const tickers = new Set<string>(["SPY", "QQQ", ...state.settings.coreTickers]);
  for (const thesis of state.theses) {
    const ticker = thesis.ticker.trim().toUpperCase();
    if (ticker) tickers.add(ticker);
  }
  for (const trade of state.trades) {
    const ticker = trade.ticker.trim().toUpperCase();
    if (ticker) tickers.add(ticker);
  }
  return [...tickers].sort().map((ticker) => {
    const quote = quoteFor(prices, ticker);
    const check = assessQuote(
      quote ? { price: quote.price, previousClose: quote.previousClose, asOf: quote.asOf, bars: quote.bars } : undefined,
      today,
    );
    return {
      ticker,
      asOf: quote?.asOf ?? null,
      ageTradingDays: check.ageTradingDays,
      source: quote?.source ?? prices?.source ?? "none",
      block: check.block,
      message: check.message,
      role: isBenchmarkTicker(ticker) ? "benchmark" : "holding",
    };
  });
}

function freezeScheduled(action: BriefAction, today: string): BriefAction {
  if (action.side !== "buy") return action;
  return {
    ...action,
    id: `${today}:CB:${action.id}`,
    title: `Circuit breaker · ${action.title}`,
    side: "freeze",
    dollars: 0,
    shares: null,
    rule: "CB",
    funding: undefined,
    record: undefined,
    reason: `Circuit breaker is on, so this scheduled buy is frozen until the desk review. ${action.reason}`,
  };
}

function toBriefAction(action: EngineAction, today: string, index: number, positions: EnginePosition[]): BriefAction {
  const titles: Record<EngineAction["rule"], string> = {
    CB: "Circuit breaker · add frozen",
    R1: "Rule 1 · kill",
    R2: "Rule 2 · trim",
    R3: "Rule 3 · milestone miss",
    R4: "Rule 4 · fear tranche",
    R5: "Rule 5 · confirmation tranche",
    HOLD: "Hold · check logged",
  };
  let funding: string | undefined;
  if (action.side === "sell") funding = "Proceeds go to cash (dry powder).";
  if (action.side === "buy") {
    const parts = [];
    if (action.fromEarmarked > 0) parts.push(`${cents(action.fromEarmarked).toLocaleString("en-US", { style: "currency", currency: "USD" })} earmarked`);
    if (action.fromDry > 0) parts.push(`${cents(action.fromDry).toLocaleString("en-US", { style: "currency", currency: "USD" })} dry powder`);
    if (parts.length) funding = parts.join(" + ");
  }
  const position = positions.find((item) => item.id === action.positionId);
  const record =
    (action.side === "buy" || action.side === "sell") && action.dollars != null && action.dollars > 0
      ? {
          sleeve: position?.sleeve === "core" ? ("core" as const) : ("conviction" as const),
          thesisId: position?.id.startsWith("thesis:") ? position.id.slice("thesis:".length) : undefined,
          tranche:
            action.rule === "R5" ? (3 as const) : action.rule === "R4" ? (position?.tranche2Deployed ? ("fear" as const) : (2 as const)) : undefined,
        }
      : undefined;
  return {
    id: `${today}:${action.rule}:${action.ticker}:${index}`,
    ticker: action.ticker,
    title: titles[action.rule],
    side: action.side,
    dollars: action.dollars,
    shares: action.shares,
    rule: action.rule,
    reason: action.reason,
    funding,
    record,
  };
}

function dueReminders(state: DeskState, today: string, performance: Performance): BriefAction[] {
  if (today < state.settings.startDate) return [];
  const actions: BriefAction[] = [];
  const months = elapsedMonthDates(state.settings.startDate, today, 1, 1);
  const latestMonth = months.at(-1);
  if (latestMonth && !state.theses.some((thesis) => thesis.openedOn.startsWith(monthKey(latestMonth)))) {
    actions.push({
      id: `pitch:${monthKey(latestMonth)}`,
      ticker: "DESK",
      title: "Monthly scout",
      side: "review",
      dollars: null,
      shares: null,
      rule: "PITCH",
      reason: `A monthly pitch is due for ${prettyDate(latestMonth)}. Generate or start a thesis. This is a prompt to you. It does not scout by itself, approve a card, or trade.`,
    });
  }
  if (latestMonth && state.reviews.scorecardThrough !== monthKey(latestMonth)) {
    const qqq = performance.qqqReturn;
    const spy = performance.spyReturn;
    const book = performance.bookReturn;
    actions.push({
      id: `scorecard:${monthKey(latestMonth)}`,
      ticker: "DESK",
      title: "Monthly scorecard",
      side: "review",
      dollars: null,
      shares: null,
      rule: "SCORECARD",
      reason: `Scorecard for ${prettyDate(latestMonth)}. Mark each milestone hit or missed, write down P(thesis) so calibration can be scored later, and compare returns. Book ${pct(book)} since funding. SPY ${pct(spy)} is the whole-book benchmark. Themes are judged against QQQ ${pct(qqq)}. Neither benchmark is a buy or a sell. The loop does not skip this step.`,
    });
  }

  const quarters = elapsedMonthDates(state.settings.startDate, today, 3, 3);
  const latestQuarter = quarters.at(-1);
  if (latestQuarter && (state.reviews.postmortemThrough == null || state.reviews.postmortemThrough < latestQuarter)) {
    actions.push({
      id: `postmortem:${latestQuarter}`,
      ticker: "DESK",
      title: "Quarterly post-mortem",
      side: "review",
      dollars: null,
      shares: null,
      rule: "POSTMORTEM",
      reason: `Post-mortem due ${prettyDate(latestQuarter)}. For every win and loss, decide skill or luck. Change at most one rule, version the rulebook, and refresh valuation bands. Do not change a rule during a drawdown.`,
    });
  }

  const years = elapsedMonthDates(state.settings.startDate, today, 12, 12);
  const latestYear = years.at(-1);
  if (latestYear && (state.reviews.rebalanceThrough == null || state.reviews.rebalanceThrough < latestYear)) {
    actions.push({
      id: `rebalance:${latestYear}`,
      ticker: "CORE",
      title: "Yearly core rebalance",
      side: "review",
      dollars: null,
      shares: null,
      rule: "REBALANCE",
      reason: `Rebalance the core stock basket back to equal weight. Due ${prettyDate(latestYear)}. Record any trade on the ledger after you place it. Do not buy an index.`,
    });
  }
  if (latestYear && (state.reviews.metaRuleThrough == null || state.reviews.metaRuleThrough < latestYear)) {
    const conv = performance.convictionReturn;
    const qqq = performance.qqqReturn;
    let comparison = "The comparison needs a QQQ snapshot and a complete conviction mark. Neither number is invented.";
    if (conv != null && qqq != null) {
      comparison =
        conv < qqq
          ? `Conviction sleeve ${pct(conv)} trails QQQ ${pct(qqq)}. Rule 04: the sleeve has not earned its place. Cut it and move that capital into the core stock basket.`
          : `Conviction sleeve ${pct(conv)} versus QQQ ${pct(qqq)}. The sleeve is ahead of QQQ on this test, so it keeps its place.`;
    }
    actions.push({
      id: `metarule:${latestYear}`,
      ticker: "QQQ",
      title: "Meta-rule test · conviction vs QQQ",
      side: "review",
      dollars: null,
      shares: null,
      rule: "METARULE",
      reason: `Four-quarter test due ${prettyDate(latestYear)}. ${comparison} Idle cash is carried at par and is not put in T-bills. Benchmark anchor is the first snapshot this browser recorded, not a backfilled history. QQQ is the comparison, not a buy.`,
    });
  }
  return actions;
}

function milestoneReminders(state: DeskState, today: string): BriefAction[] {
  const actions: BriefAction[] = [];
  for (const thesis of state.theses.filter((item) => !item.archived)) {
    thesis.milestones.forEach((milestone, index) => {
      if (milestone.status !== "pending" || !milestone.byDate || milestone.byDate > today) return;
      actions.push({
        id: `milestone:${thesis.id}:${milestone.id}`,
        ticker: thesis.ticker.toUpperCase() || "—",
        title: `Milestone M${index + 1} date reached`,
        side: "review",
        dollars: null,
        shares: null,
        rule: "MILESTONE-DUE",
        reason: `${thesis.theme || thesis.ticker}: "${milestone.metric || "Milestone"}" was due ${prettyDate(milestone.byDate)} and is still pending. Mark it hit only on reported numbers, or missed. The engine will not assume a miss from the calendar alone. A miss freezes adds. A second miss is a kill.`,
      });
    });
  }
  return actions;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

export function briefSignature(brief: Brief): string {
  const { generatedAt: _generatedAt, ...rest } = brief;
  return JSON.stringify(rest);
}

