import type { BenchmarkAnchor, DeskState, Postmortem, Reviews, Scorecard, Settings, Thesis, Trade } from "../types";
import { isThemeCount } from "./allocation";
import { MAX_CAPITAL_DOLLARS } from "./cents";
import { isValidISO, todayISO } from "./dates";
import { defaultRulebook, sanitizeThresholds, type Rulebook } from "./rulebook";
import { emptyLoop, isLoopStage } from "./thesis";

export const STORAGE_KEY = "rsi.v2";
export const LEGACY_KEY = "alpha-desk.v1";
export const BACKUP_KEY = "rsi.backup";

type Store = Pick<Storage, "getItem" | "setItem">;

export function blankReviews(): Reviews {
  return {
    scorecardThrough: null,
    postmortemThrough: null,
    rebalanceThrough: null,
    metaRuleThrough: null,
  };
}

export function defaultAnchor(): BenchmarkAnchor {
  return { spy: null, qqq: null };
}

export function defaultState(today = todayISO()): DeskState {
  return {
    version: 2,
    settings: {
      capital: 100_000,
      startDate: today,
      themeCount: 3,
      coreTicker: "SPY",
    },
    theses: [],
    trades: [],
    peakBook: null,
    reviews: blankReviews(),
    briefs: [],
    benchmarkAnchor: defaultAnchor(),
    notificationDate: null,
    rulebook: defaultRulebook(today),
    scorecards: [],
    postmortems: [],
  };
}

export function loadState(): DeskState {
  const store = browserStore();
  if (!store) return defaultState();
  return readDesk(store);
}

export function saveState(state: DeskState): void {
  const store = browserStore();
  if (!store) return;
  store.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function serializeState(state: DeskState): string {
  return JSON.stringify(state, null, 2);
}

/** Reads v2, or migrates v1 after writing the raw legacy payload to the backup key. */
export function readDesk(store: Store, today = todayISO()): DeskState {
  const current = store.getItem(STORAGE_KEY);
  if (current) return normalizeState(JSON.parse(current), today);
  const legacy = store.getItem(LEGACY_KEY);
  if (legacy) {
    store.setItem(BACKUP_KEY, legacy);
    const migrated = normalizeState(JSON.parse(legacy), today);
    store.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  }
  return defaultState(today);
}

/**
 * Validates imported JSON. Writes the previous desk to the backup key before replacing it.
 * A bad file leaves the live key untouched.
 */
export function importState(raw: string, store: Store | null, today = todayISO()): DeskState {
  const parsed = JSON.parse(raw) as unknown;
  const next = normalizeState(parsed, today);
  if (store) {
    const previous = store.getItem(STORAGE_KEY);
    if (previous) store.setItem(BACKUP_KEY, previous);
    store.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function parseState(raw: string, today = todayISO()): DeskState {
  return normalizeState(JSON.parse(raw), today);
}

export function normalizeState(value: unknown, today = todayISO()): DeskState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Backup is not an RSI file.");
  const input = value as Record<string, unknown>;
  if (input.version !== 1 && input.version !== 2) throw new Error("This backup is from an unsupported desk version.");
  const base = defaultState(today);
  const settings = normalizeSettings(input.settings, base.settings);
  const theses = Array.isArray(input.theses) ? input.theses.map((item, index) => normalizeThesis(item, index)) : [];
  const trades = Array.isArray(input.trades) ? input.trades.map((item, index) => normalizeTrade(item, index)) : [];
  return {
    version: 2,
    settings,
    theses,
    trades,
    peakBook: typeof input.peakBook === "number" && Number.isFinite(input.peakBook) && input.peakBook >= 0 ? input.peakBook : null,
    reviews: normalizeReviews(input.reviews),
    briefs: Array.isArray(input.briefs) ? input.briefs.filter((item) => item && typeof item === "object") as DeskState["briefs"] : [],
    benchmarkAnchor: normalizeAnchor(input.benchmarkAnchor),
    notificationDate: typeof input.notificationDate === "string" && isValidISO(input.notificationDate) ? input.notificationDate : null,
    rulebook: normalizeRulebook(input.rulebook, settings.startDate),
    scorecards: Array.isArray(input.scorecards) ? input.scorecards.filter(isScorecard) : [],
    postmortems: Array.isArray(input.postmortems) ? input.postmortems.filter(isPostmortem) : [],
  };
}

function normalizeSettings(value: unknown, fallback: Settings): Settings {
  if (!value || typeof value !== "object") return fallback;
  const input = value as Partial<Settings>;
  if (typeof input.capital !== "number" || !Number.isFinite(input.capital) || input.capital <= 0 || input.capital > MAX_CAPITAL_DOLLARS) {
    throw new Error("Funded capital must be a positive amount at or under $100,000,000.");
  }
  if (!input.startDate || !isValidISO(input.startDate)) throw new Error("The start date is not a calendar day.");
  if (typeof input.themeCount !== "number" || !isThemeCount(input.themeCount)) throw new Error("Conviction holds 3, 4, or 5 themes.");
  return {
    capital: input.capital,
    startDate: input.startDate,
    themeCount: input.themeCount,
    coreTicker: input.coreTicker === "QQQ" ? "QQQ" : "SPY",
  };
}

function normalizeThesis(value: unknown, index: number): Thesis {
  if (!value || typeof value !== "object") throw new Error(`Thesis ${index + 1} is not an object.`);
  const thesis = value as Partial<Thesis>;
  if (typeof thesis.id !== "string" || !thesis.id) throw new Error(`Thesis ${index + 1} has no id.`);
  if (typeof thesis.ticker !== "string") throw new Error(`Thesis ${thesis.id} has no ticker.`);
  if (!Array.isArray(thesis.milestones)) throw new Error(`Thesis ${thesis.id} has no milestones.`);
  const loop = emptyLoop(thesis.archived ? "archived" : "thesis");
  return {
    id: thesis.id,
    theme: stringOr(thesis.theme, ""),
    ticker: thesis.ticker,
    openedOn: typeof thesis.openedOn === "string" && isValidISO(thesis.openedOn) ? thesis.openedOn : "1970-01-01",
    version: typeof thesis.version === "number" && Number.isFinite(thesis.version) ? thesis.version : 1,
    marketBelief: stringOr(thesis.marketBelief, ""),
    ourBelief: stringOr(thesis.ourBelief, ""),
    whyWrong: stringOr(thesis.whyWrong, ""),
    killCondition: stringOr(thesis.killCondition, ""),
    killHit: thesis.killHit === true,
    milestones: thesis.milestones.filter((item) => item && typeof item === "object") as Thesis["milestones"],
    valuationMetric: stringOr(thesis.valuationMetric, ""),
    addBelow: stringOr(thesis.addBelow, ""),
    trimAbove: stringOr(thesis.trimAbove, ""),
    valuationPercentile: finiteOrNull(thesis.valuationPercentile),
    bearCase: stringOr(thesis.bearCase, ""),
    targetMode: thesis.targetMode === "custom" ? "custom" : "plan",
    targetDollars: finiteOrNull(thesis.targetDollars),
    probability: finiteOrNull(thesis.probability),
    benchmark: stringOr(thesis.benchmark, "QQQ"),
    archived: thesis.archived === true,
    log: Array.isArray(thesis.log) ? thesis.log.filter((item) => item && typeof item === "object") as Thesis["log"] : [],
    stage: isLoopStage(thesis.stage) ? thesis.stage : loop.stage,
    disbelief: thesis.disbelief === "negative-sentiment" || thesis.disbelief === "low-valuation" ? thesis.disbelief : null,
    evidence: stringOr(thesis.evidence, ""),
    bearClaims: Array.isArray(thesis.bearClaims)
      ? thesis.bearClaims.filter((claim) => claim && typeof claim === "object" && typeof (claim as { id?: string }).id === "string") as Thesis["bearClaims"]
      : [],
    beatsBear: thesis.beatsBear === true ? true : thesis.beatsBear === false ? false : null,
    revisitOn: typeof thesis.revisitOn === "string" && isValidISO(thesis.revisitOn) ? thesis.revisitOn : null,
    addBelowPrice: finiteOrNull(thesis.addBelowPrice),
    trimAbovePrice: finiteOrNull(thesis.trimAbovePrice),
  };
}

function normalizeTrade(value: unknown, index: number): Trade {
  if (!value || typeof value !== "object") throw new Error(`Trade ${index + 1} is not an object.`);
  const trade = value as Partial<Trade>;
  if (typeof trade.id !== "string" || !trade.id) throw new Error(`Trade ${index + 1} has no id.`);
  if (trade.side !== "buy" && trade.side !== "sell") throw new Error(`Trade ${trade.id} has no side.`);
  if (typeof trade.dollars !== "number" || !Number.isFinite(trade.dollars) || trade.dollars < 0) {
    throw new Error(`Trade ${trade.id} has an unsafe dollar amount.`);
  }
  if (typeof trade.shares !== "number" || !Number.isFinite(trade.shares) || trade.shares < 0) {
    throw new Error(`Trade ${trade.id} has an unsafe share count.`);
  }
  if (typeof trade.price !== "number" || !Number.isFinite(trade.price) || trade.price <= 0) {
    throw new Error(`Trade ${trade.id} has an unsafe price.`);
  }
  if (!trade.date || !isValidISO(trade.date)) throw new Error(`Trade ${trade.id} has no date.`);
  const tranche = trade.tranche === 1 || trade.tranche === 2 || trade.tranche === 3 || trade.tranche === "fear" ? trade.tranche : undefined;
  return {
    id: trade.id,
    date: trade.date,
    ticker: stringOr(trade.ticker, ""),
    side: trade.side,
    dollars: trade.dollars,
    shares: trade.shares,
    price: trade.price,
    sleeve: trade.sleeve === "conviction" ? "conviction" : "core",
    thesisId: typeof trade.thesisId === "string" ? trade.thesisId : undefined,
    tranche,
    note: stringOr(trade.note, ""),
  };
}

function normalizeReviews(value: unknown): Reviews {
  const blank = blankReviews();
  if (!value || typeof value !== "object") return blank;
  const input = value as Partial<Reviews>;
  return {
    scorecardThrough: typeof input.scorecardThrough === "string" ? input.scorecardThrough : null,
    postmortemThrough: typeof input.postmortemThrough === "string" ? input.postmortemThrough : null,
    rebalanceThrough: typeof input.rebalanceThrough === "string" ? input.rebalanceThrough : null,
    metaRuleThrough: typeof input.metaRuleThrough === "string" ? input.metaRuleThrough : null,
  };
}

function normalizeAnchor(value: unknown): BenchmarkAnchor {
  if (!value || typeof value !== "object") return defaultAnchor();
  const input = value as Partial<BenchmarkAnchor>;
  return { spy: isAnchor(input.spy) ? input.spy : null, qqq: isAnchor(input.qqq) ? input.qqq : null };
}

function normalizeRulebook(value: unknown, adoptedOn: string): Rulebook {
  const fallback = defaultRulebook(adoptedOn);
  if (!value || typeof value !== "object") return fallback;
  const input = value as Partial<Rulebook>;
  if (!input.thresholds || typeof input.thresholds !== "object") return fallback;
  return {
    version: typeof input.version === "string" ? input.version : fallback.version,
    cycle: typeof input.cycle === "number" && Number.isFinite(input.cycle) ? input.cycle : 1,
    adoptedOn: typeof input.adoptedOn === "string" && isValidISO(input.adoptedOn) ? input.adoptedOn : adoptedOn,
    thresholds: sanitizeThresholds(input.thresholds),
    changelog: Array.isArray(input.changelog) ? input.changelog.filter((item) => item && typeof item === "object") as Rulebook["changelog"] : [],
  };
}

function isScorecard(value: unknown): value is Scorecard {
  if (!value || typeof value !== "object") return false;
  const card = value as Scorecard;
  return typeof card.id === "string" && typeof card.month === "string" && Array.isArray(card.calls);
}

function isPostmortem(value: unknown): value is Postmortem {
  if (!value || typeof value !== "object") return false;
  const note = value as Postmortem;
  return typeof note.id === "string" && (note.skillOrLuck === "skill" || note.skillOrLuck === "luck" || note.skillOrLuck === "mixed");
}

function isAnchor(value: unknown): value is { date: string; price: number } {
  if (!value || typeof value !== "object") return false;
  const point = value as { date?: string; price?: number };
  return typeof point.date === "string" && isValidISO(point.date) && typeof point.price === "number" && point.price > 0;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function browserStore(): Store | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}
