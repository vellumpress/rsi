import type { BriefAction } from "../types";
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

function coreGap(coreBought: number, coreTranche: number, index: 1 | 2 | 3): number {
  const gap = coreTranche * index - coreBought;
  return Math.min(coreTranche, Math.max(0, gap));
}

export function coreTrancheDone(coreBought: number, coreTranche: number, index: 1 | 2 | 3): boolean {
  return coreBought + 0.009 >= coreTranche * index;
}

export function scheduleRows(input: {
  startDate: string;
  today: string;
  coreTranche: number;
  coreBought: number;
  themes: ThemeSchedule[];
  metaRuleDone: boolean;
}): ScheduleRow[] {
  const week0 = input.startDate;
  const month1 = addMonths(input.startDate, 1);
  const month2 = addMonths(input.startDate, 2);
  const quarter4 = addMonths(input.startDate, 12);
  const themesOpen = input.themes.filter((theme) => !theme.tranche1 && !theme.blocked);
  const week0Done = coreTrancheDone(input.coreBought, input.coreTranche, 1) && themesOpen.length === 0;
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
      amount: cents(input.coreTranche + themesOpen.reduce((sum, theme) => sum + theme.trancheDollars, 0)),
      detail: "Core tranche 1, plus the entry third of each approved theme. Everything else stays in T-bills.",
    },
    {
      id: "month1",
      label: "Month 1",
      date: month1,
      status: status(month1, coreTrancheDone(input.coreBought, input.coreTranche, 2)),
      amount: cents(input.coreTranche),
      detail: "Core tranche 2 of 3.",
    },
    {
      id: "month2",
      label: "Month 2",
      date: month2,
      status: status(month2, coreTrancheDone(input.coreBought, input.coreTranche, 3)),
      amount: cents(input.coreTranche),
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
      detail: "First meta-rule test: conviction sleeve against QQQ. If it trails after four quarters, own more of the index.",
    },
  ];
}

export function dueDeployment(input: {
  startDate: string;
  today: string;
  coreTicker: string;
  coreTranche: number;
  coreBought: number;
  themes: ThemeSchedule[];
}): BriefAction[] {
  if (input.today < input.startDate) return [];
  const actions: BriefAction[] = [];
  const steps: { index: 1 | 2 | 3; date: string; rule: "WEEK0" | "MONTH1" | "MONTH2"; label: string }[] = [
    { index: 1, date: input.startDate, rule: "WEEK0", label: "Week 0" },
    { index: 2, date: addMonths(input.startDate, 1), rule: "MONTH1", label: "Month 1" },
    { index: 3, date: addMonths(input.startDate, 2), rule: "MONTH2", label: "Month 2" },
  ];

  for (const step of steps) {
    if (input.today < step.date) continue;
    const gap = cents(coreGap(input.coreBought, input.coreTranche, step.index));
    if (gap <= 0.01) continue;
    actions.push({
      id: `${input.today}:${step.rule}:${input.coreTicker}`,
      ticker: input.coreTicker,
      title: `${step.label} · core tranche ${step.index} of 3`,
      side: "buy",
      dollars: gap,
      shares: null,
      rule: step.rule,
      reason: `${step.label} (${prettyDate(step.date)}). Buy $${gap.toLocaleString("en-US")} of the broad index. Core is deployed in three equal monthly tranches. This dollar amount is the plan, not a live price.`,
      funding: "Cash reserved for the core sleeve, which sits in T-bills until this buy.",
      record: { sleeve: "core", tranche: step.index },
    });
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
        reason: `Week 0 (${prettyDate(input.startDate)}). Buy the entry third of ${theme.theme || theme.ticker}. Tranches 2 and 3 wait for the execution engine. Unspent thirds stay earmarked in T-bills.`,
        funding: "Earmarked T-bills for this theme.",
        record: { sleeve: "conviction", thesisId: theme.id, tranche: 1 },
      });
    }
  }

  return actions;
}
