import type { Rulebook } from "./lib/rulebook";

export type ThemeCount = 3 | 4 | 5;

export type LoopStage = "scout" | "thesis" | "redteam" | "watchlist" | "approved" | "sized" | "archived";

export type Disbelief = "negative-sentiment" | "low-valuation";

export type MilestoneStatus = "pending" | "hit" | "missed";

export interface Milestone {
  id: string;
  metric: string;
  target: string;
  byDate: string;
  status: MilestoneStatus;
  resolvedOn: string | null;
  /** True only when the user marks a hit from reported numbers, not guidance. */
  reported?: boolean;
}

export interface MonthlyLogEntry {
  id: string;
  month: string;
  probability: number | null;
  priceVsBand: string;
  engineAction: string;
  note: string;
}

export interface Thesis {
  id: string;
  theme: string;
  ticker: string;
  openedOn: string;
  version: number;
  marketBelief: string;
  ourBelief: string;
  whyWrong: string;
  killCondition: string;
  killHit: boolean;
  milestones: Milestone[];
  valuationMetric: string;
  addBelow: string;
  trimAbove: string;
  /** Manual 0–100 percentile vs the name's own 10-year history. */
  valuationPercentile: number | null;
  bearCase: string;
  targetMode: "plan" | "custom";
  targetDollars: number | null;
  /** P(thesis) over three years, 0–100. */
  probability: number | null;
  benchmark: string;
  archived: boolean;
  log: MonthlyLogEntry[];
  /** p.2 loop stage. Calendar entry buys require approved or sized. */
  stage: LoopStage;
  disbelief: Disbelief | null;
  evidence: string;
  bearClaims: { id: string; claim: string; probability: number }[];
  beatsBear: boolean | null;
  revisitOn: string | null;
  addBelowPrice: number | null;
  trimAbovePrice: number | null;
}

export type TrancheTag = 1 | 2 | 3 | "fear";

export interface Trade {
  id: string;
  date: string;
  ticker: string;
  side: "buy" | "sell";
  dollars: number;
  shares: number;
  price: number;
  sleeve: "core" | "conviction";
  thesisId?: string;
  tranche?: TrancheTag;
  note: string;
}

export interface Settings {
  /** Dollars funded into the desk. The playbook's worked example is 100000. */
  capital: number;
  /** YYYY-MM-DD. Week 0 of the deployment calendar. */
  startDate: string;
  themeCount: ThemeCount;
  /** User-chosen individual stocks. Empty until the user types them. Not a recommendation. */
  coreTickers: string[];
  /** Equal-weight slot count. Default 8. About 8–10 is the intended basket. */
  coreSlots: number;
}

export interface Reviews {
  /** Latest monthly scorecard acknowledged, YYYY-MM. */
  scorecardThrough: string | null;
  /** Latest post-mortem due date acknowledged, YYYY-MM-DD. */
  postmortemThrough: string | null;
  rebalanceThrough: string | null;
  metaRuleThrough: string | null;
}

export interface AnchorPoint {
  date: string;
  price: number;
}

export interface BenchmarkAnchor {
  spy: AnchorPoint | null;
  qqq: AnchorPoint | null;
}

export interface PriceQuote {
  ticker: string;
  price: number | null;
  sma200: number | null;
  high52w: number | null;
  asOf: string | null;
  currency: string | null;
  bars: number;
  /** Prior session adjusted close. Not the 2-year chartPreviousClose. */
  previousClose: number | null;
  /** Yahoo chart meta. EQUITY is the only type RSI will buy. */
  instrumentType: string | null;
  quoteType: string | null;
  source: string;
  error?: string;
}

export interface PriceBook {
  fetchedAt: string | null;
  source: string;
  quotes: Record<string, PriceQuote>;
}

export type ActionSide = "buy" | "sell" | "hold" | "freeze" | "review";

export type RuleCode =
  | "CB"
  | "R1"
  | "R2"
  | "R3"
  | "R4"
  | "R5"
  | "HOLD"
  | "WEEK0"
  | "MONTH1"
  | "MONTH2"
  | "SCORECARD"
  | "POSTMORTEM"
  | "REBALANCE"
  | "METARULE"
  | "MILESTONE-DUE"
  | "DATA"
  | "FUND"
  | "CORE";

export interface BriefAction {
  id: string;
  ticker: string;
  title: string;
  side: ActionSide;
  /** Null when a price is missing and sizing would be invented. */
  dollars: number | null;
  shares: number | null;
  rule: RuleCode;
  reason: string;
  funding?: string;
  /** Present when the row can be written onto the ledger. */
  record?: {
    sleeve: "core" | "conviction";
    thesisId?: string;
    tranche?: TrancheTag;
  };
}

export interface Brief {
  id: string;
  date: string;
  generatedAt: string;
  fridaySweep: boolean;
  circuitBreaker: boolean;
  circuitBreakerEvaluated: boolean;
  bookValue: number | null;
  peak: number | null;
  drawdown: number | null;
  dataGaps: string[];
  schedule: BriefAction[];
  engine: BriefAction[];
  reminders: BriefAction[];
  notes: string[];
  /** Age, session date, and source for every symbol the brief used. */
  quotes: QuoteStamp[];
}

export interface QuoteStamp {
  ticker: string;
  asOf: string | null;
  ageTradingDays: number | null;
  source: string;
  block: "ok" | "short" | "stale" | "invalid" | "missing";
  message: string;
  /** Benchmarks are fetched for comparison and are never orders. */
  role: "benchmark" | "holding";
}

export interface Scorecard {
  id: string;
  month: string;
  date: string;
  notes: string;
  calls: { id: string; label: string; probability: number; outcome: 0 | 1 | null }[];
  brier: number | null;
  bookReturn: number | null;
  spyReturn: number | null;
  qqqReturn: number | null;
  convictionReturn: number | null;
}

export interface Postmortem {
  id: string;
  quarterDate: string;
  date: string;
  skillOrLuck: "skill" | "luck" | "mixed";
  notes: string;
}

export interface DeskState {
  version: 2;
  settings: Settings;
  theses: Thesis[];
  trades: Trade[];
  peakBook: number | null;
  reviews: Reviews;
  briefs: Brief[];
  benchmarkAnchor: BenchmarkAnchor;
  notificationDate: string | null;
  rulebook: Rulebook;
  scorecards: Scorecard[];
  postmortems: Postmortem[];
}
