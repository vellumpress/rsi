const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function todayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function toISO(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function isValidISO(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const { y, m, d } = parseISO(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Calendar add that clamps month-ends (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const { y, m, d } = parseISO(iso);
  const zero = m - 1 + months;
  const year = y + Math.floor(zero / 12);
  const month = ((zero % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toISO(year, month + 1, Math.min(d, last));
}

export function weekdayUTC(iso: string): number {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isFriday(iso: string): boolean {
  return weekdayUTC(iso) === 5;
}

/** The Friday sweep on this date, or the next Friday after it. */
export function nextFriday(iso: string): string {
  const { y, m, d } = parseISO(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const add = (5 - dt.getUTCDay() + 7) % 7;
  dt.setUTCDate(dt.getUTCDate() + add);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function prettyDate(iso: string): string {
  if (!isValidISO(iso)) return iso;
  const { y, m, d } = parseISO(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function quarterKey(iso: string): string {
  const { y, m } = parseISO(iso);
  return `${y}-Q${Math.ceil(m / 3)}`;
}

/** Completed quarter boundaries from the start date through today. Four means the meta-rule is due. */
export function elapsedQuarters(start: string, today: string): number {
  return elapsedMonthDates(start, today, 3, 3).length;
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parseISO(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Due dates at month offsets first, first+step, ... that are on or before today. */
export function elapsedMonthDates(start: string, today: string, first: number, step: number): string[] {
  const out: string[] = [];
  for (let n = first; n < 2400; n += step) {
    const date = addMonths(start, n);
    if (date > today) break;
    out.push(date);
  }
  return out;
}
