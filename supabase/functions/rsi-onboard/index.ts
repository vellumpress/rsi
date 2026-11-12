// Generated from supabase/functions/rsi-onboard/entry.ts by scripts/bundle-functions.mjs. Deploy this file.

// supabase/functions/rsi-onboard/entry.ts
import { createClient } from "npm:@supabase/supabase-js@2.49.8";

// src/lib/cents.ts
var MAX_CAPITAL_DOLLARS = 1e8;
function toCents(dollars) {
  if (!Number.isFinite(dollars)) return null;
  const cents2 = Math.round(dollars * 100);
  if (!Number.isSafeInteger(cents2)) return null;
  return cents2;
}
function fromCents(cents2) {
  return cents2 / 100;
}
function splitCents(totalCents, weights) {
  if (!Number.isSafeInteger(totalCents)) throw new Error("Cent total is not a safe integer.");
  const raw = weights.map((weight) => totalCents * weight);
  const floors = raw.map((value) => Math.floor(value));
  let left = totalCents - floors.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, frac: value - Math.floor(value) })).sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const item of order) {
    if (left <= 0) break;
    floors[item.index] += 1;
    left -= 1;
  }
  return floors;
}

// src/lib/allocation.ts
var DEFAULT_CORE_SLOTS = 8;
var MIN_CORE_SLOTS = 1;
var MAX_CORE_SLOTS = 20;
var CORE_WEIGHT = 0.3;
var CONVICTION_WEIGHT = 0.45;
var DRY_POWDER_WEIGHT = 0.25;
var POSITION_CAP_WEIGHT = 0.15;
function isThemeCount(n) {
  return n === 3 || n === 4 || n === 5;
}
function allocate(capital, themeCount) {
  const safe = safeAllocate(capital, themeCount);
  if (!safe.ok || !isThemeCount(themeCount)) throw new Error(safe.ok ? "Conviction holds 3, 4, or 5 themes." : safe.error);
  return safe.allocation;
}
function safeAllocate(capital, themeCount) {
  if (!Number.isFinite(capital) || capital <= 0) return { ok: false, error: "Capital must be a positive amount." };
  if (capital > MAX_CAPITAL_DOLLARS) return { ok: false, error: "That amount is too large to size safely." };
  if (!Number.isInteger(themeCount) || themeCount < 0 || themeCount > 5) {
    return { ok: false, error: "Conviction holds 3, 4, or 5 themes. Zero is an empty sleeve. More than five is refused." };
  }
  const total = toCents(capital);
  if (total == null) return { ok: false, error: "Capital must be a positive amount." };
  const [coreC, convictionC, dryC] = splitCents(total, [CORE_WEIGHT, CONVICTION_WEIGHT, DRY_POWDER_WEIGHT]);
  const capC = splitCents(total, [POSITION_CAP_WEIGHT, 1 - POSITION_CAP_WEIGHT])[0];
  let perThemeC = 0;
  let warning;
  if (themeCount === 0) {
    warning = "No themes. The conviction sleeve stays in cash until a card is approved.";
  } else if (themeCount < 3) {
    perThemeC = Math.min(Math.floor(convictionC / themeCount), capC);
    warning = "The playbook runs 3 to 5 themes. This target is capped at 15% of the book.";
  } else {
    perThemeC = Math.floor(convictionC / themeCount);
  }
  const coreTrancheC = splitCents(coreC, [1 / 3, 1 / 3, 1 / 3])[0];
  const themeTrancheC = perThemeC === 0 ? 0 : splitCents(perThemeC, [1 / 3, 1 / 3, 1 / 3])[0];
  return {
    ok: true,
    allocation: {
      capital: fromCents(total),
      themeCount,
      core: fromCents(coreC),
      conviction: fromCents(convictionC),
      dryPowder: fromCents(dryC),
      coreTranche: fromCents(coreTrancheC),
      perTheme: fromCents(perThemeC),
      themeTranche: fromCents(themeTrancheC),
      positionCap: fromCents(capC),
      warning
    }
  };
}
function themeTarget(alloc, thesis) {
  if (thesis.targetMode === "custom" && thesis.targetDollars != null && Number.isFinite(thesis.targetDollars)) {
    return Math.min(Math.max(0, thesis.targetDollars), alloc.positionCap);
  }
  return Math.min(alloc.perTheme, alloc.positionCap);
}
function clampCoreSlots(slots) {
  if (!Number.isInteger(slots)) return DEFAULT_CORE_SLOTS;
  return Math.min(MAX_CORE_SLOTS, Math.max(MIN_CORE_SLOTS, slots));
}
function coreNameTarget(alloc, chosen, slots) {
  if (chosen <= 0) return 0;
  const width = Math.max(chosen, clampCoreSlots(slots));
  const total = toCents(alloc.core);
  const cap = toCents(alloc.positionCap);
  if (total == null || cap == null) return 0;
  const equal = Math.floor(total / width);
  return fromCents(Math.min(equal, cap));
}
function coreNameTranches(alloc, chosen, slots) {
  const target = toCents(coreNameTarget(alloc, chosen, slots));
  if (target == null || target <= 0) return [0, 0, 0];
  const parts = splitCents(target, [1 / 3, 1 / 3, 1 / 3]);
  return [fromCents(parts[0]), fromCents(parts[1]), fromCents(parts[2])];
}

// src/lib/instruments.ts
var BENCHMARKS = /* @__PURE__ */ new Set(["SPY", "QQQ"]);
function isBenchmarkTicker(ticker) {
  return BENCHMARKS.has(ticker.trim().toUpperCase());
}
function classifyInstrument(input) {
  const ticker = input.ticker?.trim().toUpperCase() ?? "";
  if (isBenchmarkTicker(ticker)) return "etf";
  const blob = `${input.instrumentType ?? ""} ${input.quoteType ?? ""}`.toUpperCase();
  if (blob.includes("MUTUALFUND") || blob.includes("MUTUAL FUND")) return "mutualfund";
  if (blob.includes("ETF")) return "etf";
  if (/\bEQUITY\b/.test(blob)) return "equity";
  if (blob.trim()) return "other";
  return "unknown";
}
function buyBlockedReason(kind) {
  if (kind === "equity") return null;
  if (kind === "etf" || kind === "mutualfund") {
    return "RSI recommends only individual stocks. This symbol is an ETF or fund, so no buy is sized. SPY and QQQ are benchmarks only.";
  }
  if (kind === "unknown") {
    return "The snapshot has not confirmed this symbol is an individual equity. No buy until Yahoo chart meta says EQUITY.";
  }
  return "Only an individual equity can be bought. This symbol is not EQUITY.";
}

// src/lib/dates.ts
function toISO(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}
function isValidISO(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const { y, m, d } = parseISO(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function weekdayUTC(iso) {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function addDays(iso, days) {
  const { y, m, d } = parseISO(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// src/lib/holidays.ts
function observed(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  return toISO(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
function nthWeekday(year, month, weekday, n) {
  const date = new Date(Date.UTC(year, month - 1, 1));
  const delta = (weekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(1 + delta + (n - 1) * 7);
  return toISO(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
function lastWeekday(year, month, weekday) {
  const date = new Date(Date.UTC(year, month, 0));
  const delta = (date.getUTCDay() - weekday + 7) % 7;
  date.setUTCDate(date.getUTCDate() - delta);
  return toISO(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
function goodFriday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  const easter = new Date(Date.UTC(year, month - 1, day));
  easter.setUTCDate(easter.getUTCDate() - 2);
  return toISO(easter.getUTCFullYear(), easter.getUTCMonth() + 1, easter.getUTCDate());
}
function nyseHolidays(year) {
  const dates = [
    observed(year, 1, 1),
    nthWeekday(year, 1, 1, 3),
    nthWeekday(year, 2, 1, 3),
    goodFriday(year),
    lastWeekday(year, 5, 1),
    observed(year, 6, 19),
    observed(year, 7, 4),
    nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 11, 4, 4),
    observed(year, 12, 25)
  ];
  const newYear = new Date(Date.UTC(year + 1, 0, 1));
  if (newYear.getUTCDay() === 6) dates.push(toISO(year, 12, 31));
  return dates;
}
var cache = /* @__PURE__ */ new Map();
function isNyseHoliday(iso) {
  if (!isValidISO(iso)) return false;
  const { y } = parseISO(iso);
  let set = cache.get(y);
  if (!set) {
    set = new Set(nyseHolidays(y));
    cache.set(y, set);
  }
  return set.has(iso);
}

// src/lib/quotes.ts
function tradingDaysBetween(from, today) {
  if (!isValidISO(from) || !isValidISO(today)) return null;
  if (today < from) return null;
  let count = 0;
  let cursor = from;
  while (cursor < today) {
    cursor = addDays(cursor, 1);
    const day = weekdayUTC(cursor);
    if (day !== 0 && day !== 6 && !isNyseHoliday(cursor)) count += 1;
  }
  return count;
}
function assessQuote(quote, today) {
  if (!quote || quote.price == null) {
    return { block: "missing", ageTradingDays: null, message: "Insufficient data, no action. No price in the snapshot." };
  }
  if (!Number.isFinite(quote.price) || quote.price <= 0) {
    return { block: "invalid", ageTradingDays: null, message: "Insufficient data, no action. The price is zero, negative, or not a number." };
  }
  if (quote.previousClose != null && quote.previousClose > 0) {
    const jump = Math.abs(quote.price / quote.previousClose - 1);
    if (jump > 0.4) {
      return { block: "invalid", ageTradingDays: null, message: "Insufficient data, no action. The price jumped more than 40% versus the prior close." };
    }
  }
  if (!quote.asOf || !isValidISO(quote.asOf)) {
    return { block: "stale", ageTradingDays: null, message: "Insufficient data, no action. The snapshot has no session date." };
  }
  const age = tradingDaysBetween(quote.asOf, today);
  if (age == null) {
    return { block: "invalid", ageTradingDays: null, message: "Insufficient data, no action. The session date is after today." };
  }
  if (age > 2) {
    return { block: "stale", ageTradingDays: age, message: `Insufficient data, no action. The quote is ${age} trading days old.` };
  }
  if (quote.bars < 200) {
    return { block: "short", ageTradingDays: age, message: "Fewer than 200 closes. Price signals that need that history are not computed." };
  }
  return { block: "ok", ageTradingDays: age, message: "Quote passed the sanity checks." };
}

// src/lib/wholeShares.ts
function wholeBuy(dollars, price) {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  const shares = Math.floor(dollars / price);
  if (shares < 1) return null;
  const spent = Math.round(shares * price * 100) / 100;
  return { shares, dollars: spent, price };
}

// src/lib/yahoo.ts
function yahooChartUrl(ticker) {
  const symbol = encodeURIComponent(ticker.trim().toUpperCase());
  return `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=2y&interval=1d&includeAdjustedClose=true`;
}
function emptyQuote(ticker, error, source = "Yahoo Finance chart") {
  return {
    ticker: ticker.toUpperCase(),
    price: null,
    sma200: null,
    high52w: null,
    asOf: null,
    currency: null,
    bars: 0,
    previousClose: null,
    instrumentType: null,
    quoteType: null,
    source,
    error
  };
}
function nyDate(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(ms));
}
function chartSeries(payload, fallbackTicker) {
  const chart = payload?.chart;
  const result = chart?.result?.[0];
  const meta = result?.meta ?? {};
  const ticker = String(meta.symbol || fallbackTicker).toUpperCase();
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.adjclose?.[0]?.adjclose ?? [];
  const highs = result?.indicators?.quote?.[0]?.high ?? [];
  const bars = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const close = closes[i];
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;
    const high = highs[i];
    bars.push({
      date: nyDate(stamps[i] * 1e3),
      close,
      high: typeof high === "number" && Number.isFinite(high) ? high : null
    });
  }
  return {
    ticker,
    bars,
    instrumentType: typeof meta.instrumentType === "string" ? meta.instrumentType : null,
    quoteType: typeof meta.quoteType === "string" ? meta.quoteType : null,
    currency: typeof meta.currency === "string" ? meta.currency : null
  };
}
function quoteAsOf(series, asOf) {
  let end = -1;
  for (let i = 0; i < series.bars.length; i += 1) {
    if (series.bars[i].date <= asOf) end = i;
    else break;
  }
  if (end < 0) return emptyQuote(series.ticker, "No session on or before this date.");
  const used = series.bars.slice(0, end + 1);
  const price = used[used.length - 1].close;
  const previousClose = used.length >= 2 ? used[used.length - 2].close : null;
  const sma200 = used.length >= 200 ? used.slice(-200).reduce((sum, bar) => sum + bar.close, 0) / 200 : null;
  const cutoff = addDaysIso(used[used.length - 1].date, -365);
  let high52w = -Infinity;
  for (const bar of used) {
    if (bar.date < cutoff) continue;
    const high = bar.high ?? bar.close;
    if (high > high52w) high52w = high;
  }
  return {
    ticker: series.ticker,
    price,
    sma200,
    high52w: Number.isFinite(high52w) ? high52w : null,
    asOf: used[used.length - 1].date,
    currency: series.currency,
    bars: used.length,
    previousClose,
    instrumentType: series.instrumentType,
    quoteType: series.quoteType,
    source: "Yahoo Finance chart",
    error: sma200 == null ? "Fewer than 200 closes, so the 200-day average is withheld." : void 0
  };
}
function addDaysIso(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// src/lib/onboardPlan.ts
var STARTER_UNIVERSE = [
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
  "CAT"
];
var ONBOARD_PLAN = "rsi-onboard-plan-v1";
var UNIVERSE = new Set(STARTER_UNIVERSE);
var REBUILD_CONFIRM = "An order is already marked done today. Choose Rebuild and confirm to replace the plan. No new orders were stored.";
function reuseDecision(input) {
  if (!input.existing || input.existing.notedOn !== input.today) return "rebuild";
  if (input.existing.filledToday && !input.rebuild) {
    const same = sameAmount(input.existing.amount, input.amount);
    return same ? "reuse" : "confirm";
  }
  if (!input.rebuild && sameAmount(input.existing.amount, input.amount)) return "reuse";
  return "rebuild";
}
function sameAmount(left, right) {
  const a = toCents(left);
  const b = toCents(right);
  return a != null && a === b;
}
function planPrompt(amount) {
  return [
    `Starter universe (individual large-cap stocks only): ${STARTER_UNIVERSE.join(", ")}.`,
    `Funded amount is ${amount} dollars. The code sizes shares. You only pick names.`,
    "Pick exactly 8 core tickers and 4 conviction themes.",
    "Each theme is one ticker from that universe and a short theme name. A ticker may appear once.",
    "Do not pick SPY, QQQ, an ETF, an index fund, or a T-bill. Do not include prices or share counts.",
    'Reply with JSON only: {"core":["AAPL"],"themes":[{"ticker":"NVDA","theme":"semiconductors"}]}'
  ].join(" ");
}
function parsePlanPick(text) {
  let value;
  try {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    value = JSON.parse((fence ? fence[1] : text).trim());
  } catch {
    return { ok: false, error: "Grok did not return a plan. No orders were stored." };
  }
  const record = value && typeof value === "object" ? value : null;
  if (!record || !Array.isArray(record.core) || !Array.isArray(record.themes)) {
    return { ok: false, error: "Grok did not return a plan. No orders were stored." };
  }
  const core = record.core.map(normalizeTicker);
  const themes = [];
  for (const item of record.themes) {
    const row2 = item && typeof item === "object" ? item : null;
    const ticker = normalizeTicker(row2?.ticker);
    const theme = typeof row2?.theme === "string" ? row2.theme.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    if (!ticker || !theme) return { ok: false, error: "Grok did not name every theme. No orders were stored." };
    themes.push({ ticker, theme });
  }
  const checked = checkPick({ core: core.filter((ticker) => Boolean(ticker)), themes });
  if (!checked.ok) return checked;
  return { ok: true, pick: checked.pick };
}
function normalizeTicker(value) {
  if (typeof value !== "string") return null;
  const ticker = value.trim().toUpperCase();
  return /^[A-Z]{1,5}$/.test(ticker) ? ticker : null;
}
function checkPick(pick) {
  if (pick.core.length !== DEFAULT_CORE_SLOTS) {
    return { ok: false, error: "The core basket needs 8 names from the starter universe. No orders were stored." };
  }
  if (pick.themes.length < 3 || pick.themes.length > 5) {
    return { ok: false, error: "Conviction needs 3, 4, or 5 themes from the starter universe. No orders were stored." };
  }
  const seen = /* @__PURE__ */ new Set();
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
async function priceUniverse(today, fetchChart2) {
  const quotes = /* @__PURE__ */ new Map();
  for (const ticker of STARTER_UNIVERSE) {
    let payload;
    try {
      payload = await fetchChart2(ticker);
    } catch {
      return { ok: false, error: `${ticker} price could not be fetched. No orders were stored.` };
    }
    const series = chartSeries(payload, ticker);
    const quote = quoteAsOf(series, today);
    const check = assessQuote(
      { price: quote.price, previousClose: quote.previousClose, asOf: quote.asOf, bars: quote.bars },
      today
    );
    if (check.block === "stale" || check.block === "invalid" || check.block === "missing") {
      return { ok: false, error: `${ticker}: ${check.message} No orders were stored.` };
    }
    const blocked = buyBlockedReason(classifyInstrument({
      ticker,
      instrumentType: quote.instrumentType,
      quoteType: quote.quoteType
    }));
    if (blocked || quote.price == null || !quote.asOf) {
      return { ok: false, error: `${ticker}: ${blocked ?? "No usable price."} No orders were stored.` };
    }
    quotes.set(ticker, { ticker, price: quote.price, asOf: quote.asOf });
  }
  return { ok: true, quotes };
}
function firstTranche(dollars) {
  const cents2 = toCents(dollars);
  if (cents2 == null || cents2 <= 0) return 0;
  return fromCents(splitCents(cents2, [1 / 3, 1 / 3, 1 / 3])[0]);
}
function sizeBuy(ticker, tranche, price, cap) {
  const order = wholeBuy(tranche, price);
  if (!order) {
    return { ok: false, error: `${ticker} costs more than the first tranche at ${price}. No orders were stored.` };
  }
  if (order.dollars > cap + 1e-3) {
    return { ok: false, error: `${ticker} would exceed the 15% cap. No orders were stored.` };
  }
  return { ok: true, shares: order.shares, dollars: order.dollars };
}
function buildOrders(input) {
  const orders = [];
  const coreFull = coreNameTarget(input.alloc, input.pick.core.length, DEFAULT_CORE_SLOTS);
  const coreTranche = coreNameTranches(input.alloc, input.pick.core.length, DEFAULT_CORE_SLOTS)[0];
  if (coreFull <= 0 || coreFull > input.alloc.positionCap + 1e-3) {
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
      reason: "Core tranche 1 of 3. 30% basket, 15% cap. Not a fill."
    }));
  }
  const themeFull = themeTarget(input.alloc, { targetMode: "plan", targetDollars: null });
  const themeTranche = firstTranche(themeFull);
  if (themeFull <= 0 || themeFull > input.alloc.positionCap + 1e-3) {
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
      reason: `Conviction tranche 1 of 3 (${theme.theme}). 45% sleeve, bought in thirds. Not a fill.`
    }));
  }
  return { ok: true, orders };
}
function row(input) {
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
      theme: input.theme
    },
    reference_price: input.price,
    shares: input.shares,
    dollars: input.dollars,
    reason: input.reason
  };
}
async function runOnboard(input) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "Enter how much to invest. No orders were stored." };
  }
  if (input.amount > MAX_CAPITAL_DOLLARS) {
    return { ok: false, error: "That amount is too large to size safely. No orders were stored." };
  }
  const priced = await priceUniverse(input.today, input.fetchChart);
  if (!priced.ok) return priced;
  let raw;
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
    quotes: priced.quotes
  });
  if (!built.ok) return built;
  const spent = built.orders.reduce((sum, order) => sum + order.dollars, 0);
  const plan = {
    userId: input.userId,
    amount: alloc.capital,
    notedOn: input.today,
    run: built.orders[0]?.inputs.run ?? crypto.randomUUID(),
    cash: Math.round((alloc.capital - spent) * 100) / 100,
    orders: built.orders
  };
  try {
    await input.save(plan);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The plan could not be stored.";
    return { ok: false, error: message };
  }
  return { ok: true, plan };
}

// supabase/functions/rsi-onboard/entry.ts
var PRIVATE = "This RSI desk is private.";
var ORIGINS = /* @__PURE__ */ new Set([
  "https://vellumpress.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
]);
function cors(origin) {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", origin && ORIGINS.has(origin) ? origin : "https://vellumpress.github.io");
  headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Vary", "Origin");
  headers.set("Content-Type", "application/json");
  return headers;
}
function json(status, body, origin) {
  return new Response(JSON.stringify(body), { status, headers: cors(origin) });
}
Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json(405, { error: "POST only." }, origin);
  const header = req.headers.get("Authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return json(401, { error: "Sign in again. Nothing was written." }, origin);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: header } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await userClient.auth.getUser();
  const email = data.user?.email?.trim().toLowerCase() ?? "";
  if (error || !data.user?.id || !email) return json(401, { error: "Sign in again. Nothing was written." }, origin);
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const listed = await admin.from("allowlist").select("email").eq("email", email).maybeSingle();
  if (listed.error || listed.data?.email !== email) return json(403, { error: PRIVATE }, origin);
  let body = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Send an amount. No orders were stored." }, origin);
  }
  const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
  const rebuild = body.rebuild === true;
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const userId = data.user.id;
  if (!Number.isFinite(amount) || amount <= 0) return json(422, { error: "Enter how much to invest. No orders were stored." }, origin);
  if (amount > MAX_CAPITAL_DOLLARS) return json(422, { error: "That amount is too large to size safely. No orders were stored." }, origin);
  let existing;
  try {
    existing = await readToday(admin, userId, today);
  } catch {
    return json(422, { error: "Today's plan could not be read. No orders were stored." }, origin);
  }
  const decision = reuseDecision({ today, amount, rebuild, existing });
  if (decision !== "rebuild") {
    return json(200, {
      ok: true,
      plan: ONBOARD_PLAN,
      sticky: true,
      notice: decision === "confirm" ? REBUILD_CONFIRM : void 0
    }, origin);
  }
  const result = await runOnboard({
    userId,
    amount,
    today,
    fetchChart,
    completeJson: askGrok,
    save: (plan) => storePlan(admin, plan)
  });
  if (!result.ok) return json(422, { error: result.error }, origin);
  return json(200, {
    ok: true,
    plan: ONBOARD_PLAN,
    capital: result.plan.amount,
    cash: result.plan.cash,
    orders: result.plan.orders.length
  }, origin);
});
async function readToday(admin, userId, today) {
  const recs = await admin.from("recommendations").select("id, inputs, created_at").eq("user_id", userId).eq("noted_on", today).order("created_at", { ascending: true });
  if (recs.error) throw new Error(recs.error.message);
  const rows = (recs.data ?? []).flatMap((row2) => {
    const inputs = row2.inputs && typeof row2.inputs === "object" ? row2.inputs : null;
    if (inputs?.plan !== ONBOARD_PLAN || typeof inputs.run !== "string") return [];
    return [{ id: String(row2.id), run: inputs.run, capital: Number(inputs.capital) }];
  });
  if (rows.length === 0) return null;
  const latestRun = rows[rows.length - 1].run;
  const latest = rows.filter((row2) => row2.run === latestRun);
  const fills = await admin.from("fills").select("recommendation_id").eq("user_id", userId).in("recommendation_id", rows.map((row2) => row2.id));
  if (fills.error) throw new Error(fills.error.message);
  return {
    notedOn: today,
    amount: latest[0]?.capital ?? Number.NaN,
    filledToday: (fills.data ?? []).some((row2) => row2.recommendation_id)
  };
}
async function fetchChart(ticker) {
  const response = await fetch(yahooChartUrl(ticker), { headers: { "user-agent": "rsi-onboard/1.0" } });
  if (!response.ok) throw new Error(`${ticker} price could not be fetched. No orders were stored.`);
  return response.json();
}
async function askGrok(prompt) {
  const apiKey = Deno.env.get("XAI_API_KEY") ?? "";
  if (!apiKey) throw new Error("Grok is not configured. No orders were stored.");
  const model = Deno.env.get("RSI_MODEL")?.trim() || "grok-4.7";
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Reply with JSON only. Do not include prices or share counts." },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!response.ok) throw new Error("Grok did not return a plan. No orders were stored.");
  const body = await response.json().catch(() => null);
  const text = body?.choices?.[0]?.message?.content;
  if (!text?.trim()) throw new Error("Grok did not return a plan. No orders were stored.");
  return text;
}
async function storePlan(admin, plan) {
  const profile = await admin.from("profiles").upsert({
    user_id: plan.userId,
    capital: plan.amount,
    noted_on: plan.notedOn,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  if (profile.error) throw new Error("The amount could not be stored. No orders were stored.");
  const inserted = await admin.from("recommendations").insert(plan.orders).select("id");
  if (inserted.error || !inserted.data?.length) throw new Error("The plan could not be stored.");
  const keep = new Set(inserted.data.map((row2) => String(row2.id)));
  const filled = await admin.from("fills").select("recommendation_id").eq("user_id", plan.userId).not("recommendation_id", "is", null);
  if (filled.error) throw new Error("The plan could not be stored.");
  for (const row2 of filled.data ?? []) {
    if (row2.recommendation_id) keep.add(String(row2.recommendation_id));
  }
  const existing = await admin.from("recommendations").select("id").eq("user_id", plan.userId);
  if (existing.error) throw new Error("The plan could not be stored.");
  const drop = (existing.data ?? []).map((row2) => String(row2.id)).filter((id) => !keep.has(id));
  if (drop.length === 0) return;
  const removed = await admin.from("recommendations").delete().in("id", drop).eq("user_id", plan.userId);
  if (removed.error) throw new Error("The plan could not be stored.");
}
