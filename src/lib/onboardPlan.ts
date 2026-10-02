import { allocate, coreNameTarget, coreNameTranches, DEFAULT_CORE_SLOTS, themeTarget, type Allocation } from "./allocation";
import { fromCents, MAX_CAPITAL_DOLLARS, splitCents, toCents } from "./cents";
import { classifyInstrument, buyBlockedReason } from "./instruments";
import { assessQuote } from "./quotes";
import { wholeBuy } from "./wholeShares";
import { chartSeries, quoteAsOf } from "./yahoo";

/**
 * Documented starter universe for the first plan.
 * Individual large-cap common stocks only. No ETFs, index funds, or T-bills.
 * SPY and QQQ are benchmarks and are not in this list.
 */
export const STARTER_UNIVERSE = [
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "NVDA",
  "META",
  "JPM",
  "JNJ",
  "UNH",
  "XOM",
  "COST",
  "CAT",
] as const;

export const ONBOARD_PLAN = "rsi-onboard-plan-v1";

const UNIVERSE = new Set<string>(STARTER_UNIVERSE);

export interface PlanPick {
  core: string[];
  themes: { ticker: string; theme: string }[];
}

export interface RecommendationRow {
  user_id: string;
  noted_on: string;
  ticker: string;
  side: "buy";
  rule: "CORE-T1" | "CONV-T1";
  probability: null;
  expected_outcome: string;
  inputs: {
    plan: typeof ONBOARD_PLAN;
    run: string;
    capital: number;
    sleeve: "core" | "conviction";
    tranche: 1;
    theme: string | null;
  };
  reference_price: number;
  shares: number;
  dollars: number;
  reason: string;
}

export interface StoredPlan {
  userId: string;
  amount: number;
  notedOn: string;
  run: string;
  cash: number;
  orders: RecommendationRow[];
}

export interface RunOnboardInput {
  userId: string;
  amount: number;
  today: string;
  fetchChart: (ticker: string) => Promise<unknown>;
  completeJson: (prompt: string) => Promise<string>;
  save: (plan: StoredPlan) => Promise<void>;
}

export type OnboardResult = { ok: true; plan: StoredPlan } | { ok: false; error: string };

export function planPrompt(amount: number): string {
  return [
    `Starter universe (individual large-cap stocks only): ${STARTER_UNIVERSE.join(", ")}.`,
    `Funded amount is ${amount} dollars. The code sizes shares. You only pick names.`,
    "Pick exactly 8 core tickers and 4 conviction themes.",
    "Each theme is one ticker from that universe and a short theme name. A ticker may appear once.",
    "Do not pick SPY, QQQ, an ETF, an index fund, or a T-bill. Do not include prices or share counts.",
    'Reply with JSON only: {"core":["AAPL"],"themes":[{"ticker":"NVDA","theme":"semiconductors"}]}',
  ].join(" ");
}

export function parsePlanPick(text: string): { ok: true; pick: PlanPick } | { ok: false; error: string } {
  let value: unknown;
  try {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    value = JSON.parse((fence ? fence[1] : text).trim());
  } catch {
    return { ok: false, error: "Grok did not return a plan. No orders were stored." };
  }
  const record = value && typeof value === "object" ? (value as { core?: unknown; themes?: unknown }) : null;
  if (!record || !Array.isArray(record.core) || !Array.isArray(record.themes)) {
    return { ok: false, error: "Grok did not return a plan. No orders were stored." };
  }
  const core = record.core.map(normalizeTicker);
  const themes: { ticker: string; theme: string }[] = [];
  for (const item of record.themes) {
    const row = item && typeof item === "object" ? (item as { ticker?: unknown; theme?: unknown }) : null;
    const ticker = normalizeTicker(row?.ticker);
    const theme = typeof row?.theme === "string" ? row.theme.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    if (!ticker || !theme) return { ok: false, error: "Grok did not name every theme. No orders were stored." };
    themes.push({ ticker, theme });
  }
  const checked = checkPick({ core: core.filter((ticker): ticker is string => Boolean(ticker)), themes });
  if (!checked.ok) return checked;
  return { ok: true, pick: checked.pick };
}

function normalizeTicker(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ticker = value.trim().toUpperCase();
  return /^[A-Z]{1,5}$/.test(ticker) ? ticker : null;
}

function checkPick(pick: PlanPick): { ok: true; pick: PlanPick } | { ok: false; error: string } {
  if (pick.core.length !== DEFAULT_CORE_SLOTS) {
    return { ok: false, error: "The core basket needs 8 names from the starter universe. No orders were stored." };
  }
  if (pick.themes.length < 3 || pick.themes.length > 5) {
    return { ok: false, error: "Conviction needs 3, 4, or 5 themes from the starter universe. No orders were stored." };
  }
  const seen = new Set<string>();
  for (const ticker of [...pick.core, ...pick.themes.map((theme) => theme.ticker)]) {
    if (!UNIVERSE.has(ticker)) {
      return { ok: false, error: `${ticker} is outside the starter universe. No orders were stored.` };
    }
    if (seen.has(ticker)) {
      return { ok: false, error: `${ticker} was picked twice. No orders were stored.` };
    }
    seen.add(ticker);
  }
  return { ok: true, pick };
}

interface Priced {
  ticker: string;
  price: number;
  asOf: string;
}

async function priceUniverse(today: string, fetchChart: RunOnboardInput["fetchChart"]): Promise<{ ok: true; quotes: Map<string, Priced> } | { ok: false; error: string }> {
  const quotes = new Map<string, Priced>();
  for (const ticker of STARTER_UNIVERSE) {
    let payload: unknown;
    try {
      payload = await fetchChart(ticker);
    } catch {
      return { ok: false, error: `${ticker} price could not be fetched. No orders were stored.` };
    }
    const series = chartSeries(payload, ticker);
    const quote = quoteAsOf(series, today);
    const check = assessQuote(
      { price: quote.price, previousClose: quote.previousClose, asOf: quote.asOf, bars: quote.bars },
      today,
    );
    if (check.block === "stale" || check.block === "invalid" || check.block === "missing") {
      return { ok: false, error: `${ticker}: ${check.message} No orders were stored.` };
    }
    const blocked = buyBlockedReason(classifyInstrument({
      ticker,
      instrumentType: quote.instrumentType,
      quoteType: quote.quoteType,
    }));
    if (blocked || quote.price == null || !quote.asOf) {
      return { ok: false, error: `${ticker}: ${blocked ?? "No usable price."} No orders were stored.` };
    }
    quotes.set(ticker, { ticker, price: quote.price, asOf: quote.asOf });
  }
  return { ok: true, quotes };
}

function firstTranche(dollars: number): number {
  const cents = toCents(dollars);
  if (cents == null || cents <= 0) return 0;
  return fromCents(splitCents(cents, [1 / 3, 1 / 3, 1 / 3])[0]);
}

function sizeBuy(ticker: string, tranche: number, price: number, cap: number): { ok: true; shares: number; dollars: number } | { ok: false; error: string } {
  const order = wholeBuy(tranche, price);
  if (!order) {
    return { ok: false, error: `${ticker} costs more than the first tranche at ${price}. No orders were stored.` };
  }
  if (order.dollars > cap + 0.001) {
    return { ok: false, error: `${ticker} would exceed the 15% cap. No orders were stored.` };
  }
  return { ok: true, shares: order.shares, dollars: order.dollars };
}

function buildOrders(input: {
  userId: string;
  notedOn: string;
  run: string;
  alloc: Allocation;
  pick: PlanPick;
  quotes: Map<string, Priced>;
}): { ok: true; orders: RecommendationRow[] } | { ok: false; error: string } {
  const orders: RecommendationRow[] = [];
  const coreFull = coreNameTarget(input.alloc, input.pick.core.length, DEFAULT_CORE_SLOTS);
  const coreTranche = coreNameTranches(input.alloc, input.pick.core.length, DEFAULT_CORE_SLOTS)[0];
  if (coreFull <= 0 || coreFull > input.alloc.positionCap + 0.001) {
    return { ok: false, error: "The core basket could not be capped at 15%. No orders were stored." };
  }
  for (const ticker of input.pick.core) {
    const quote = input.quotes.get(ticker);
    if (!quote) return { ok: false, error: `${ticker} has no price. No orders were stored.` };
    const sized = sizeBuy(ticker, coreTranche, quote.price, input.alloc.positionCap);
    if (!sized.ok) return sized;
    orders.push(row({
      userId: input.userId,
      notedOn: input.notedOn,
      run: input.run,
      capital: input.alloc.capital,
      ticker,
      rule: "CORE-T1",
      sleeve: "core",
      theme: null,
      price: quote.price,
      shares: sized.shares,
      dollars: sized.dollars,
      reason: "Core tranche 1 of 3. 30% basket, 15% cap. Not a fill.",
    }));
  }
  const themeFull = themeTarget(input.alloc, { targetMode: "plan", targetDollars: null });
  const themeTranche = firstTranche(themeFull);
  if (themeFull <= 0 || themeFull > input.alloc.positionCap + 0.001) {
    return { ok: false, error: "A conviction name would exceed the 15% cap. No orders were stored." };
  }
  for (const theme of input.pick.themes) {
    const quote = input.quotes.get(theme.ticker);
    if (!quote) return { ok: false, error: `${theme.ticker} has no price. No orders were stored.` };
    const sized = sizeBuy(theme.ticker, themeTranche, quote.price, input.alloc.positionCap);
    if (!sized.ok) return sized;
    orders.push(row({
      userId: input.userId,
      notedOn: input.notedOn,
      run: input.run,
      capital: input.alloc.capital,
      ticker: theme.ticker,
      rule: "CONV-T1",
      sleeve: "conviction",
      theme: theme.theme,
      price: quote.price,
      shares: sized.shares,
      dollars: sized.dollars,
      reason: `Conviction tranche 1 of 3 (${theme.theme}). 45% sleeve, bought in thirds. Not a fill.`,
    }));
  }
  return { ok: true, orders };
}

function row(input: {
  userId: string;
  notedOn: string;
  run: string;
  capital: number;
  ticker: string;
  rule: "CORE-T1" | "CONV-T1";
  sleeve: "core" | "conviction";
  theme: string | null;
  price: number;
  shares: number;
  dollars: number;
  reason: string;
}): RecommendationRow {
  return {
    user_id: input.userId,
    noted_on: input.notedOn,
    ticker: input.ticker,
    side: "buy",
    rule: input.rule,
    probability: null,
    expected_outcome: "First third only. Not a fill and not a trade.",
    inputs: {
      plan: ONBOARD_PLAN,
      run: input.run,
      capital: input.capital,
      sleeve: input.sleeve,
      tranche: 1,
      theme: input.theme,
    },
    reference_price: input.price,
    shares: input.shares,
    dollars: input.dollars,
    reason: input.reason,
  };
}

export async function runOnboard(input: RunOnboardInput): Promise<OnboardResult> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "Enter how much to invest. No orders were stored." };
  }
  if (input.amount > MAX_CAPITAL_DOLLARS) {
    return { ok: false, error: "That amount is too large to size safely. No orders were stored." };
  }
  const priced = await priceUniverse(input.today, input.fetchChart);
  if (!priced.ok) return priced;
  let raw: string;
  try {
    raw = await input.completeJson(planPrompt(input.amount));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Grok did not return a plan. No orders were stored.";
    return { ok: false, error: message };
  }
  const parsed = parsePlanPick(raw);
  if (!parsed.ok) return parsed;
  const themeCount = parsed.pick.themes.length;
  if (themeCount !== 3 && themeCount !== 4 && themeCount !== 5) {
    return { ok: false, error: "Conviction needs 3, 4, or 5 themes. No orders were stored." };
  }
  const alloc = allocate(input.amount, themeCount);
  const built = buildOrders({
    userId: input.userId,
    notedOn: input.today,
    run: crypto.randomUUID(),
    alloc,
    pick: parsed.pick,
    quotes: priced.quotes,
  });
  if (!built.ok) return built;
  const spent = built.orders.reduce((sum, order) => sum + order.dollars, 0);
  const plan: StoredPlan = {
    userId: input.userId,
    amount: alloc.capital,
    notedOn: input.today,
    run: built.orders[0]?.inputs.run ?? crypto.randomUUID(),
    cash: Math.round((alloc.capital - spent) * 100) / 100,
    orders: built.orders,
  };
  try {
    await input.save(plan);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The plan could not be stored.";
    return { ok: false, error: message };
  }
  return { ok: true, plan };
}
