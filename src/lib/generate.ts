import { addMonths, isValidISO } from "./dates";
import { buyBlockedReason, classifyInstrument, isBenchmarkTicker, type InstrumentClass } from "./instruments";
import { bandGate, bearGate } from "./loop";
import { playbookSummary } from "./playbookSummary";
import { emptyLoop } from "./thesis";
import type { LoopStage, Thesis } from "../types";

export const MODEL_VERIFY = "model-generated, verify";

export interface ScoutCandidate {
  ticker: string;
  disbelief: "negative-sentiment" | "low-valuation";
  trend: string;
  evidence: string;
}

export interface ModelFigure {
  label: string;
  value: string;
  source: string | null;
  note: typeof MODEL_VERIFY;
}

export interface CardDraft {
  ticker: string;
  theme: string;
  disbelief: "negative-sentiment" | "low-valuation";
  evidence: string;
  marketBelief: string;
  ourBelief: string;
  whyWrong: string;
  killCondition: string;
  milestones: { metric: string; target: string; byDate: string }[];
  valuationMetric: string;
  addBelow: number;
  trimAbove: number;
  valuationPercentile: number | null;
  targetDollars: number;
  probability: number;
  figures: ModelFigure[];
  /** One third of the capped target. A suggestion, not a trade. */
  tranche1Dollars: number;
}

export interface RedTeamDraft {
  bearCase: string;
  claims: { claim: string; probability: number }[];
}

export interface QuoteHint {
  ticker: string;
  price: number | null;
  instrument: InstrumentClass;
}

export function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fence ? fence[1] : text).trim();
  return JSON.parse(raw);
}

export function scoutPrompt(known: QuoteHint[]): string {
  const priced = known
    .filter((quote) => quote.price != null)
    .map((quote) => `${quote.ticker} ${quote.price} ${quote.instrument}`)
    .join(", ");
  return [
    playbookSummary(),
    "Scout step. Propose up to 3 individual equities. Each must be one company that fits a disbelief trend: improving fundamentals with negative sentiment, or a low valuation versus its own history.",
    "Reject ETFs, mutual funds, indexes, SPY, and QQQ. Do not invent prices. Known snapshot rows, if any: " + (priced || "none."),
    'Reply with JSON only: {"candidates":[{"ticker":"","disbelief":"negative-sentiment"|"low-valuation","trend":"","evidence":""}]}',
  ].join("\n\n");
}

export function cardPrompt(candidate: ScoutCandidate, positionCap: number, quote: QuoteHint | null): string {
  const priceLine = quote?.price == null ? `${candidate.ticker} has no snapshot price. Do not invent one. Leave valuation levels as your band, and label every figure.` : `Snapshot price for ${candidate.ticker} is ${quote.price}. Use that price only. Do not replace it.`;
  return [
    playbookSummary(),
    `Draft one page-5 thesis card for ${candidate.ticker}. Trend: ${candidate.trend}. Evidence seed: ${candidate.evidence}. Disbelief: ${candidate.disbelief}.`,
    priceLine,
    `Target dollars must be at most ${positionCap}, which is 15% of the book. Tranche 1 is one third of that target and is not a trade.`,
    "Three milestones, each with a date YYYY-MM-DD and a reported-number target. Kill condition is one reported fact. Why the market is wrong must be evidence, not a story.",
    "Every figure you assert goes in figures with a source string or null. Those figures are model-generated and must be verified.",
    'Reply with JSON only: {"ticker":"","theme":"","disbelief":"negative-sentiment"|"low-valuation","evidence":"","marketBelief":"","ourBelief":"","whyWrong":"","killCondition":"","milestones":[{"metric":"","target":"","byDate":""},{"metric":"","target":"","byDate":""},{"metric":"","target":"","byDate":""}],"valuationMetric":"","addBelow":0,"trimAbove":0,"valuationPercentile":0,"targetDollars":0,"probability":0,"figures":[{"label":"","value":"","source":null}]}',
  ].join("\n\n");
}

export function redTeamPrompt(card: CardDraft): string {
  return [
    playbookSummary(),
    `Red team ${card.ticker}. Write the strongest bear case against this card. Give each claim a probability from 0 to 100. Do not invent a price. Do not approve the thesis.`,
    `Market belief: ${card.marketBelief}`,
    `Our belief: ${card.ourBelief}`,
    `Why wrong: ${card.whyWrong}`,
    `Kill: ${card.killCondition}`,
    'Reply with JSON only: {"bearCase":"","claims":[{"claim":"","probability":0}]}',
  ].join("\n\n");
}

export function validateScout(raw: unknown, known: QuoteHint[] = []): { ok: true; candidates: ScoutCandidate[] } | { ok: false; error: string } {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { candidates?: unknown }).candidates) ? (raw as { candidates: unknown[] }).candidates : null;
  if (!list || list.length === 0) return { ok: false, error: "Scout JSON needs a candidates array." };
  const candidates: ScoutCandidate[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") return { ok: false, error: "A scout candidate was not an object." };
    const row = item as Record<string, unknown>;
    const ticker = typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
    const gate = equityGate(ticker, known);
    if (gate) return { ok: false, error: gate };
    const disbelief = row.disbelief === "negative-sentiment" || row.disbelief === "low-valuation" ? row.disbelief : null;
    const trend = typeof row.trend === "string" ? row.trend.trim() : "";
    const evidence = typeof row.evidence === "string" ? row.evidence.trim() : "";
    if (!disbelief || !trend || !evidence) return { ok: false, error: `${ticker || "A candidate"} needs a disbelief type, a trend, and evidence.` };
    candidates.push({ ticker, disbelief, trend, evidence });
  }
  return { ok: true, candidates };
}

export function validateCard(raw: unknown, positionCap: number, known: QuoteHint[] = []): { ok: true; card: CardDraft } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Card JSON was not an object." };
  const row = raw as Record<string, unknown>;
  const ticker = typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
  const blocked = equityGate(ticker, known);
  if (blocked) return { ok: false, error: blocked };
  const disbelief = row.disbelief === "negative-sentiment" || row.disbelief === "low-valuation" ? row.disbelief : null;
  const text = (key: string) => (typeof row[key] === "string" ? row[key].trim() : "");
  const required = ["theme", "evidence", "marketBelief", "ourBelief", "whyWrong", "killCondition", "valuationMetric"] as const;
  if (!disbelief || required.some((key) => !text(key))) return { ok: false, error: "The card is missing a required text field." };
  const milestones = Array.isArray(row.milestones) ? row.milestones : [];
  if (milestones.length !== 3) return { ok: false, error: "The card needs exactly three milestones." };
  const parsedMilestones = milestones.map((item) => {
    if (!item || typeof item !== "object") return null;
    const milestone = item as Record<string, unknown>;
    const metric = typeof milestone.metric === "string" ? milestone.metric.trim() : "";
    const target = typeof milestone.target === "string" ? milestone.target.trim() : "";
    const byDate = typeof milestone.byDate === "string" ? milestone.byDate : "";
    if (!metric || !target || !isValidISO(byDate)) return null;
    return { metric, target, byDate };
  });
  if (parsedMilestones.some((item) => item == null)) return { ok: false, error: "Each milestone needs a metric, a reported target, and a real date." };
  const addBelow = numberOrNull(row.addBelow);
  const trimAbove = numberOrNull(row.trimAbove);
  const targetDollars = numberOrNull(row.targetDollars);
  const probability = numberOrNull(row.probability);
  if (addBelow == null || !(addBelow > 0) || trimAbove == null || !(trimAbove > addBelow)) {
    return { ok: false, error: "The valuation band needs add-below and a higher trim-above." };
  }
  if (targetDollars == null || !(targetDollars > 0)) return { ok: false, error: "Target dollars must be positive." };
  if (probability == null || probability < 0 || probability > 100) return { ok: false, error: "P(thesis) must be between 0 and 100." };
  const percentile = row.valuationPercentile == null ? null : numberOrNull(row.valuationPercentile);
  if (row.valuationPercentile != null && (percentile == null || percentile < 0 || percentile > 100)) {
    return { ok: false, error: "Valuation percentile must be between 0 and 100, or omitted." };
  }
  const capped = Math.min(targetDollars, positionCap);
  const figures = readFigures(row.figures);
  if (capped < targetDollars) {
    figures.push({ label: "target", value: String(capped), source: "15% position cap", note: MODEL_VERIFY });
  }
  return {
    ok: true,
    card: {
      ticker,
      theme: text("theme"),
      disbelief,
      evidence: text("evidence"),
      marketBelief: text("marketBelief"),
      ourBelief: text("ourBelief"),
      whyWrong: text("whyWrong"),
      killCondition: text("killCondition"),
      milestones: parsedMilestones as CardDraft["milestones"],
      valuationMetric: text("valuationMetric"),
      addBelow,
      trimAbove,
      valuationPercentile: percentile,
      targetDollars: capped,
      probability,
      figures,
      tranche1Dollars: Math.round((capped / 3) * 100) / 100,
    },
  };
}

export function validateRedTeam(raw: unknown): { ok: true; redTeam: RedTeamDraft } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Red team JSON was not an object." };
  const row = raw as Record<string, unknown>;
  const bearCase = typeof row.bearCase === "string" ? row.bearCase.trim() : "";
  const claims = Array.isArray(row.claims) ? row.claims : [];
  if (!bearCase || claims.length === 0) return { ok: false, error: "The red team needs a bear case and at least one claim." };
  const parsed = claims.map((item) => {
    if (!item || typeof item !== "object") return null;
    const claim = item as Record<string, unknown>;
    const text = typeof claim.claim === "string" ? claim.claim.trim() : "";
    const probability = numberOrNull(claim.probability);
    if (!text || probability == null || probability < 0 || probability > 100) return null;
    return { claim: text, probability };
  });
  if (parsed.some((item) => item == null)) return { ok: false, error: "Each bear claim needs text and a probability from 0 to 100." };
  return { ok: true, redTeam: { bearCase, claims: parsed as RedTeamDraft["claims"] } };
}

export interface GatedCard {
  thesis: Thesis;
  stage: LoopStage;
  /** Always false. Approval is a later button on the loop page. */
  approved: false;
  /** Always null. Generation never writes a trade. */
  trade: null;
  reason: string;
}

/**
 * Runs the bear gate and the band gate. The model does not get to set beatsBear.
 * Inside the band still saves as watchlist, not approved, so a generated card cannot trade.
 */
export function gateGeneratedCard(input: {
  card: CardDraft;
  redTeam: RedTeamDraft;
  beatsBear: boolean | null;
  price: number | null;
  quoteOk: boolean;
  today: string;
  id: string;
  milestoneIds: [string, string, string];
  claimIds: string[];
}): GatedCard {
  const bear = bearGate(
    {
      beatsBear: input.beatsBear,
      claims: input.redTeam.claims.map((claim, index) => ({ id: input.claimIds[index] ?? `claim-${index}`, claim: claim.claim, probability: claim.probability })),
      thesisProbability: input.card.probability,
    },
    input.today,
  );
  let stage: LoopStage = "redteam";
  let archived = false;
  let revisitOn: string | null = null;
  let reason = bear.reason;
  if (bear.decision === "archive") {
    stage = "archived";
    archived = true;
    revisitOn = bear.revisitOn;
  } else if (bear.decision === "pass") {
    const band = bandGate({
      price: input.price,
      addBelow: input.card.addBelow,
      trimAbove: input.card.trimAbove,
      quoteOk: input.quoteOk,
    });
    stage = "watchlist";
    reason = `${bear.reason} ${band.reason} The card stays a draft. Checking the band on the loop page is what can approve it. This step did not approve it and did not trade.`;
    if (band.status !== "inside") reason = `${bear.reason} ${band.reason} Nothing was bought.`;
  }
  const figureLines = input.card.figures.map((figure) => `${figure.label}: ${figure.value}${figure.source ? ` (${figure.source})` : ""} — ${MODEL_VERIFY}`);
  const thesis: Thesis = {
    id: input.id,
    theme: input.card.theme,
    ticker: input.card.ticker,
    openedOn: input.today,
    version: 1,
    marketBelief: input.card.marketBelief,
    ourBelief: input.card.ourBelief,
    whyWrong: input.card.whyWrong,
    killCondition: input.card.killCondition,
    killHit: false,
    milestones: input.card.milestones.map((milestone, index) => ({
      id: input.milestoneIds[index],
      metric: milestone.metric,
      target: milestone.target,
      byDate: milestone.byDate,
      status: "pending" as const,
      resolvedOn: null,
      reported: false,
    })),
    valuationMetric: input.card.valuationMetric,
    addBelow: `Add below ${input.card.addBelow}`,
    trimAbove: `Trim above ${input.card.trimAbove}`,
    valuationPercentile: input.card.valuationPercentile,
    bearCase: input.redTeam.bearCase,
    targetMode: "custom",
    targetDollars: input.card.targetDollars,
    probability: input.card.probability,
    benchmark: "QQQ",
    archived,
    log: [],
    ...emptyLoop(stage),
    disbelief: input.card.disbelief,
    evidence: `${input.card.evidence}\n\n${MODEL_VERIFY}\n${figureLines.join("\n")}`.trim(),
    bearClaims: input.redTeam.claims.map((claim, index) => ({
      id: input.claimIds[index] ?? `claim-${index}`,
      claim: claim.claim,
      probability: claim.probability,
    })),
    beatsBear: bear.decision === "pass" ? true : bear.decision === "archive" ? false : null,
    revisitOn,
    addBelowPrice: input.card.addBelow,
    trimAbovePrice: input.card.trimAbove,
  };
  if (stage === "archived") thesis.revisitOn = revisitOn ?? addMonths(input.today, 3);
  return { thesis, stage, approved: false, trade: null, reason };
}

export function watchlistDocument(tickers: string[]): string {
  const unique = [...new Set(["SPY", "QQQ", ...tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)])];
  return JSON.stringify(
    {
      tickers: unique,
      note: "SPY and QQQ are benchmarks only. Other tickers are fetch targets so the snapshot can classify them as EQUITY. This list is not a recommendation.",
    },
    null,
    2,
  );
}

export function watchlistInstructions(ticker: string): string {
  return [
    `${ticker} is not on the shipped watchlist. This static site cannot commit it.`,
    "Add the ticker to config/watchlist.json (SPY and QQQ stay on the list as benchmarks) and push to main, or edit the file on GitHub:",
    "https://github.com/vellumpress/rsi/edit/main/config/watchlist.json",
    "The weekday price job then writes public/prices.json. Until that snapshot says EQUITY, a buy stays blocked. You can also download a watchlist.json from this page and replace the repo file yourself.",
    "Generating a card does not add the ticker, does not approve it, and does not trade it.",
  ].join(" ");
}

function equityGate(ticker: string, known: QuoteHint[]): string | null {
  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) return "A candidate needs one company ticker.";
  const quote = known.find((item) => item.ticker === ticker);
  const kind = quote?.instrument ?? classifyInstrument({ ticker });
  if (isBenchmarkTicker(ticker) || kind === "etf" || kind === "mutualfund" || kind === "other") {
    return buyBlockedReason(kind === "equity" ? "etf" : kind) ?? `${ticker} is not an individual equity.`;
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function readFigures(value: unknown): ModelFigure[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const label = typeof row.label === "string" ? row.label.trim() : "";
    const figure = typeof row.value === "string" || typeof row.value === "number" ? String(row.value).trim() : "";
    if (!label || !figure) return [];
    const source = typeof row.source === "string" && row.source.trim() ? row.source.trim() : null;
    return [{ label, value: figure, source, note: MODEL_VERIFY }];
  });
}
