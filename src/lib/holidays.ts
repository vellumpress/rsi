import { isValidISO, parseISO, toISO } from "./dates";

/**
 * NYSE full-day closures. A session that closes early still trades, so it is not a holiday.
 * Used only to keep the staleness check from treating a holiday gap as a missed session.
 */

function observed(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  return toISO(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const date = new Date(Date.UTC(year, month - 1, 1));
  const delta = (weekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(1 + delta + (n - 1) * 7);
  return toISO(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const date = new Date(Date.UTC(year, month, 0));
  const delta = (date.getUTCDay() - weekday + 7) % 7;
  date.setUTCDate(date.getUTCDate() - delta);
  return toISO(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Anonymous Gregorian computus. Good Friday is the Friday before Easter Sunday. */
function goodFriday(year: number): string {
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
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(Date.UTC(year, month - 1, day));
  easter.setUTCDate(easter.getUTCDate() - 2);
  return toISO(easter.getUTCFullYear(), easter.getUTCMonth() + 1, easter.getUTCDate());
}

export function nyseHolidays(year: number): string[] {
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
    observed(year, 12, 25),
  ];
  const newYear = new Date(Date.UTC(year + 1, 0, 1));
  if (newYear.getUTCDay() === 6) dates.push(toISO(year, 12, 31));
  return dates;
}

const cache = new Map<number, Set<string>>();

export function isNyseHoliday(iso: string): boolean {
  if (!isValidISO(iso)) return false;
  const { y } = parseISO(iso);
  let set = cache.get(y);
  if (!set) {
    set = new Set(nyseHolidays(y));
    cache.set(y, set);
  }
  return set.has(iso);
}
