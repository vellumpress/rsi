import { buyBlockedReason, classifyInstrument, isBenchmarkTicker, type InstrumentClass } from "./instruments";
import { playbookSummary } from "./playbookSummary";
import type { BriefAction } from "../types";

export interface ChatFacts {
  today: string;
  fridaySweep: boolean;
  bookValue: number | null;
  peak: number | null;
  drawdown: number | null;
  cash: number | null;
  spyReturn: number | null;
  qqqReturn: number | null;
  bookReturn: number | null;
  ruleEditsLocked: boolean;
  actions: { ticker: string; side: string; rule: string; title: string; dollars: number | null; reason: string }[];
  prices: { ticker: string; price: number | null; instrument: InstrumentClass }[];
  theses: { ticker: string; theme: string; stage: string }[];
  positionCap: number;
}

export interface TradeProposal {
  kind: "trade";
  side: "buy" | "sell";
  ticker: string;
  dollars: number;
  price: number;
  sleeve: "core" | "conviction";
  note: string;
}

export interface GenerateProposal {
  kind: "generate-thesis";
}

export type Screened =
  | { ok: true; proposal: TradeProposal | GenerateProposal; reason: string }
  | { ok: false; proposal: null; reason: string };

export function grounding(facts: ChatFacts): string {
  const prices = facts.prices.map((quote) =>
    quote.price == null ? `${quote.ticker}: price unavailable in the snapshot (${quote.instrument})` : `${quote.ticker}: ${quote.price} snapshot ${quote.instrument}`,
  );
  const actions = facts.actions.map((action) => `${action.side} ${action.ticker} ${action.rule} ${action.title} dollars ${action.dollars ?? "withheld"} — ${action.reason}`);
  return [
    `Today ${facts.today}. Friday sweep: ${facts.fridaySweep ? "yes" : "no"}.`,
    `Book ${facts.bookValue ?? "unavailable"}. Peak ${facts.peak ?? "unavailable"}. Drawdown ${facts.drawdown ?? "unavailable"}. Cash ${facts.cash ?? "unavailable"}.`,
    `Returns since the stored anchor, not a backfill: book ${facts.bookReturn ?? "unavailable"}, SPY ${facts.spyReturn ?? "unavailable"}, QQQ ${facts.qqqReturn ?? "unavailable"}. SPY and QQQ are comparison only.`,
    `Rule edits locked: ${facts.ruleEditsLocked ? "yes" : "no"}. Position cap dollars ${facts.positionCap}.`,
    `Actions: ${actions.length ? actions.join(" | ") : "none"}.`,
    `Snapshot prices: ${prices.length ? prices.join(" | ") : "none"}. Do not invent a price that is unavailable.`,
    `Theses: ${facts.theses.length ? facts.theses.map((thesis) => `${thesis.ticker || "untitled"} ${thesis.stage} ${thesis.theme}`).join(" | ") : "none"}.`,
  ].join("\n");
}

export function chatSystemPrompt(facts: ChatFacts): string {
  return [
    "You are the Boss. You can see the desk. You still cannot place a trade, invent a price, or override an immutable rule.",
    "If the user asks to change a rule, say it waits for the quarterly review. One change, with evidence, and not during a 10% drawdown.",
    playbookSummary(),
    "Answer from the facts below. If a price is unavailable, say price unavailable. Never invent a price.",
    "You may propose a ledger change or a thesis generation only inside a fenced json block tagged proposal. A proposal is not a write. The user must confirm it.",
    'Trade shape: {"kind":"trade","side":"buy"|"sell","ticker":"","dollars":0,"price":0,"sleeve":"conviction"|"core","note":""}.',
    'Thesis shape: {"kind":"generate-thesis"}. That only opens the generator. It does not approve a card.',
    "Do not propose rule changes. Do not propose ETFs, mutual funds, SPY, or QQQ.",
    "Not financial advice.",
    grounding(facts),
  ].join("\n\n");
}

export function answerLocally(question: string, facts: ChatFacts): string | null {
  const text = question.trim().toLowerCase();
  if (!text) return null;
  if (/api key|xai|grok key|passcode|how do i add/.test(text)) {
    return "You are signed in. Grok runs on the RSI server and this browser does not hold an xAI key or a passcode. Not financial advice.";
  }
  if (/what should i do|today|actions/.test(text)) {
    if (facts.actions.length === 0) return `Nothing is due on ${facts.today}. ${facts.fridaySweep ? "This is the Friday sweep." : "The Friday sweep is the full engine pass."} Not financial advice.`;
    const lines = facts.actions.map((action) => `${action.side} ${action.ticker}: ${action.rule} ${action.title}. ${action.reason}`);
    return [`Today ${facts.today}. ${facts.fridaySweep ? "Friday sweep." : "Not the Friday sweep; the same rules still run."}`, ...lines, "Not financial advice. A buy or sell here is a suggestion until you confirm it on the ledger."].join("\n");
  }
  if (/which rule|why|fired/.test(text)) {
    if (facts.actions.length === 0) return "No rule fired an order today. Holds are checks, not trades.";
    return facts.actions.map((action) => `${action.ticker} ${action.rule}: ${action.reason}`).join("\n");
  }
  if (/portfolio|book|cash|peak|worth/.test(text)) {
    return `Book ${moneyish(facts.bookValue)}. Peak ${moneyish(facts.peak)}. Cash ${moneyish(facts.cash)}. Drawdown ${facts.drawdown == null ? "unavailable" : `${(facts.drawdown * 100).toFixed(1)}%`}. These are marks from the snapshot and the ledger, not a new price.`;
  }
  if (/benchmark|spy|qqq|return/.test(text)) {
    return `Book ${pct(facts.bookReturn)} since funding. SPY ${pct(facts.spyReturn)} and QQQ ${pct(facts.qqqReturn)} since the first snapshot stored in this browser. They are comparison only and are never a buy or a sell.`;
  }
  if (/friday|sweep/.test(text)) {
    return facts.fridaySweep
      ? "Today is the Friday sweep. Circuit breaker first, then each open position, first rule that fires."
      : "The official sweep is Friday. Today's brief still runs the same rules so a kill or trim is not missed.";
  }
  if (/scorecard|month/.test(text)) {
    const card = facts.actions.find((action) => action.rule === "SCORECARD" || action.rule === "PITCH");
    return card ? card.reason : "No monthly scorecard is due. The loop still wants a monthly pitch when a month has elapsed and no card was opened.";
  }
  return null;
}

export function extractProposal(text: string): unknown | null {
  const fence = text.match(/```proposal\s*([\s\S]*?)```/i) ?? text.match(/```json\s*([\s\S]*?)```/i);
  if (!fence) return null;
  try {
    return JSON.parse(fence[1]);
  } catch {
    return { kind: "invalid" };
  }
}

export function screenProposal(
  raw: unknown,
  facts: ChatFacts,
): Screened {
  if (!raw || typeof raw !== "object") return { ok: false, proposal: null, reason: "No proposal was found. Nothing was written." };
  const kind = (raw as { kind?: unknown }).kind;
  if (kind === "rule" || kind === "rule-change") {
    return { ok: false, proposal: null, reason: "The chat cannot change the rulebook. Rule edits stay on the Rules page, and they stay locked in a drawdown." };
  }
  if (kind === "generate-thesis") {
    return { ok: true, proposal: { kind: "generate-thesis" }, reason: "This opens the generator. It does not approve a card and it does not trade." };
  }
  if (kind !== "trade") return { ok: false, proposal: null, reason: "That proposal is not a trade or a thesis draft. Nothing was written." };
  const input = raw as Partial<TradeProposal>;
  const ticker = typeof input.ticker === "string" ? input.ticker.trim().toUpperCase() : "";
  const side = input.side === "sell" ? "sell" : input.side === "buy" ? "buy" : null;
  const dollars = typeof input.dollars === "number" ? input.dollars : Number.NaN;
  const price = typeof input.price === "number" ? input.price : Number.NaN;
  const sleeve = input.sleeve === "core" ? "core" : input.sleeve === "conviction" ? "conviction" : null;
  if (!side || !sleeve || !/^[A-Z0-9.-]{1,12}$/.test(ticker) || !(dollars > 0) || !(price > 0)) {
    return { ok: false, proposal: null, reason: "The proposal needs a side, one ticker, dollars, a price, and a sleeve. Nothing was written." };
  }
  const known = facts.prices.find((quote) => quote.ticker === ticker);
  const instrument = known?.instrument ?? classifyInstrument({ ticker });
  if (side === "buy") {
    if (isBenchmarkTicker(ticker) || instrument === "etf" || instrument === "mutualfund" || instrument === "other") {
      const blocked = buyBlockedReason(instrument === "equity" ? "etf" : instrument);
      return { ok: false, proposal: null, reason: blocked ?? "Only an individual equity can be proposed." };
    }
    if (instrument === "unknown") {
      return { ok: false, proposal: null, reason: buyBlockedReason("unknown") ?? "No buy until the snapshot says EQUITY." };
    }
  }
  if (side === "sell" && (isBenchmarkTicker(ticker) || instrument === "etf" || instrument === "mutualfund")) {
    return { ok: false, proposal: null, reason: "RSI does not recommend a sell of an ETF, fund, or index." };
  }
  const snapshot = known?.price;
  if (snapshot == null) {
    return { ok: false, proposal: null, reason: `${ticker} has no snapshot price. The chat will not invent one, so this proposal stops.` };
  }
  if (Math.abs(price - snapshot) / snapshot > 0.02) {
    return { ok: false, proposal: null, reason: `The proposal price ${price} does not match the snapshot ${snapshot}. No price was invented and nothing was written.` };
  }
  const proposal: TradeProposal = {
    kind: "trade",
    side,
    ticker,
    dollars,
    price: snapshot,
    sleeve,
    note: typeof input.note === "string" && input.note.trim() ? input.note.trim() : "Chat proposal. Confirm before it is written.",
  };
  return {
    ok: true,
    proposal,
    reason: `Proposed ${side} of ${ticker} for $${dollars} at the snapshot price ${snapshot}. Nothing is written until you confirm.`,
  };
}

/** A screened proposal becomes a write only after the user confirms. Confirmation false always returns null. */
export function commitScreened(screen: Screened, confirmed: boolean): TradeProposal | GenerateProposal | null {
  if (!confirmed) return null;
  if (!screen.ok) return null;
  if (screen.proposal.kind !== "trade") return null;
  return screen.proposal;
}

export function factsFromActions(actions: BriefAction[], rest: Omit<ChatFacts, "actions">): ChatFacts {
  return {
    ...rest,
    actions: actions.map((action) => ({
      ticker: action.ticker,
      side: action.side,
      rule: action.rule,
      title: action.title,
      dollars: action.dollars,
      reason: action.reason,
    })),
  };
}

function moneyish(value: number | null): string {
  if (value == null) return "unavailable";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function pct(value: number | null): string {
  if (value == null) return "unavailable";
  return `${(value * 100).toFixed(1)}%`;
}
