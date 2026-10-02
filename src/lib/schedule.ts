import type { BriefAction } from "../types";
import { coreNameTranches, type Allocation } from "./allocation";
import { addMonths, isFriday, nextFriday, prettyDate } from "./dates";
import { cents } from "./money";

export interface ThemeSchedule {
  id: string;
  ticker: string;
  theme: string;
  trancheDollars: number;
  tranche1: boolean;
  blocked: boolean;
}

export interface ScheduleRow {
  id: "week0" | "month1" | "month2" | "weekly" | "quarter4";
  label: string;
  date: string;
  status: "upcoming" | "due" | "done";
  detail: string;
  amount: number | null;
}

export function scheduleRows(input: {
  startDate: string;
  today: string;
  alloc: Pick<Allocation, "core" | "positionCap" | "coreTranche">;
  coreTickers: string[];
  coreSlots: number;
  coreBought: number;
  themes: ThemeSchedule[];
  metaRuleDone: boolean;
}): ScheduleRow[] {
  const week0 = input.startDate;
  const month1 = addMonths(input.startDate, 1);
  const month2 = addMonths(input.startDate, 2);
  const quarter4 = addMonths(input.startDate, 12);
  const themesOpen = input.themes.filter((theme) => !theme.tranche1 && !theme.blocked);
  const names = input.coreTickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean);
  const tranches = names.length ? coreNameTranches(input.alloc, names.length, input.coreSlots) : [0, 0, 0];
  const coreDue = (index: 1 | 2 | 3) => tranches.slice(0, index).reduce((sum, part) => sum + part, 0) * names.length;
  const coreDone = (index: 1 | 2 | 3) => names.length > 0 && input.coreBought + 0.009 >= coreDue(index);
  const week0Done = coreDone(1) && themesOpen.length === 0;
  const sweepDate = nextFriday(input.today < input.startDate ? input.startDate : input.today);

  const status = (date: string, done: boolean): ScheduleRow["status"] => {
    if (done) return "done";
    return input.today >= date ? "due" : "upcoming";
  };

  return [
    {
      id: "week0",
      label: "Week 0",
      date: week0,
      status: status(week0, week0Done),
      amount: cents((names.length ? tranches[0] * names.length : 0) + themesOpen.reduce((sum, theme) => sum + theme.trancheDollars, 0)),
      detail: "Core tranche 1 of each stock you chose, plus the entry third of each approved theme. Everything else stays in cash.",
    },
    {
      id: "month1",
      label: "Month 1",
      date: month1,
      status: status(month1, coreDone(2)),
      amount: cents(names.length ? tranches[1] * names.length : 0),
      detail: "Core tranche 2 of 3.",
    },
    {
      id: "month2",
      label: "Month 2",
      date: month2,
      status: status(month2, coreDone(3)),
      amount: cents(names.length ? tranches[2] * names.length : 0),
      detail: "Core tranche 3 of 3. The core sleeve is then fully deployed.",
    },
    {
      id: "weekly",
      label: "Weekly",
      date: sweepDate,
      status: input.today >= input.startDate && isFriday(input.today) ? "due" : "upcoming",
      amount: null,
      detail: "Tranches 2 and 3 only when the execution engine fires. The full sweep is every Friday.",
    },
    {
      id: "quarter4",
      label: "Quarter 4",
      date: quarter4,
      status: input.metaRuleDone ? "done" : status(quarter4, false),
      amount: null,
      detail: "First meta-rule test: conviction sleeve against QQQ. If it trails after four quarters, move that capital into the core stock basket.",
    },
  ];
}

export function dueDeployment(input: {
  startDate: string;
  today: string;
  coreTickers: string[];
  coreSlots: number;
  alloc: Pick<Allocation, "core" | "positionCap">;
  coreBoughtByTicker: Record<string, number>;
  themes: ThemeSchedule[];
}): BriefAction[] {
  if (input.today < input.startDate) return [];
  const actions: BriefAction[] = [];
  const names = input.coreTickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean);
  const steps: { index: 1 | 2 | 3; date: string; rule: "WEEK0" | "MONTH1" | "MONTH2"; label: string }[] = [
    { index: 1, date: input.startDate, rule: "WEEK0", label: "Week 0" },
    { index: 2, date: addMonths(input.startDate, 1), rule: "MONTH1", label: "Month 1" },
    { index: 3, date: addMonths(input.startDate, 2), rule: "MONTH2", label: "Month 2" },
  ];

  if (names.length === 0) {
    actions.push({
      id: `${input.today}:CORE:choose`,
      ticker: "CORE",
      title: "Choose the core basket",
      side: "review",
      dollars: null,
      shares: null,
      rule: "CORE",
      reason:
        "The core sleeve is 30% of the book: equal-weight individual stocks you choose, bought in three monthly tranches and rebalanced yearly. No names are set, so there is no core buy. SPY and QQQ are benchmarks only. They are not a substitute for the basket.",
    });
  } else {
    const tranches = coreNameTranches(input.alloc, names.length, input.coreSlots);
    if (names.length < input.coreSlots) {
      actions.push({
        id: `${input.today}:CORE:short`,
        ticker: "CORE",
        title: "Core basket is short",
        side: "review",
        dollars: null,
        shares: null,
        rule: "CORE",
        reason: `Core basket is ${names.length} of ${input.coreSlots} names. Each chosen name is one equal-weight slot. The unfilled weight stays in cash until you add a stock or lower the slot count. Nothing here is a recommended ticker.`,
      });
    }
    for (const ticker of names) {
      const bought = input.coreBoughtByTicker[ticker] ?? 0;
      for (const step of steps) {
        if (input.today < step.date) continue;
        const due = tranches.slice(0, step.index).reduce((sum, part) => sum + part, 0);
        const gap = cents(Math.max(0, due - bought));
        if (gap <= 0.01) continue;
        actions.push({
          id: `${input.today}:${step.rule}:${ticker}`,
          ticker,
          title: `${step.label} · core tranche ${step.index} of 3`,
          side: "buy",
          dollars: gap,
          shares: null,
          rule: step.rule,
          reason: `${step.label} (${prettyDate(step.date)}). Buy $${gap.toLocaleString("en-US")} of ${ticker}, one equal-weight core name. Core is deployed in three monthly tranches. This dollar amount is the plan, not a live price. You chose this name.`,
          funding: "Cash reserved for this core name.",
          record: { sleeve: "core", tranche: step.index },
        });
      }
    }
  }

  if (input.today >= input.startDate) {
    for (const theme of input.themes) {
      if (theme.tranche1) continue;
      if (theme.blocked) {
        actions.push({
          id: `${input.today}:WEEK0:${theme.ticker}:blocked`,
          ticker: theme.ticker || "—",
          title: `Week 0 · ${theme.theme || theme.ticker} entry blocked`,
          side: "freeze",
          dollars: 0,
          shares: null,
          rule: "WEEK0",
          reason: "Week 0 entry is blocked. The kill condition is met or two milestones are already missed, so this theme is not bought.",
        });
        continue;
      }
      const dollars = cents(theme.trancheDollars);
      if (dollars <= 0.01) continue;
      actions.push({
        id: `${input.today}:WEEK0:${theme.id}`,
        ticker: theme.ticker || "—",
        title: `Week 0 · entry tranche · ${theme.theme || theme.ticker}`,
        side: "buy",
        dollars,
        shares: null,
        rule: "WEEK0",
        reason: `Week 0 (${prettyDate(input.startDate)}). Buy the entry third of ${theme.theme || theme.ticker}. Tranches 2 and 3 wait for the execution engine. Unspent thirds stay earmarked in cash. The ticker has to be an individual stock.`,
        funding: "Earmarked cash for this theme.",
        record: { sleeve: "conviction", thesisId: theme.id, tranche: 1 },
      });
    }
  }

  return actions;
}
