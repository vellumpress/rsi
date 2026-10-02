export function cents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function money(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function moneyAuto(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const digits = Math.abs(n - Math.round(n)) < 0.005 ? 0 : 2;
  return money(n, digits);
}

export function priceFmt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return money(n, n >= 1000 ? 0 : 2);
}

export function pct(fraction: number | null | undefined, digits = 1): string {
  if (fraction == null || Number.isNaN(fraction)) return "—";
  const value = fraction * 100;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function pctPlain(fraction: number | null | undefined, digits = 1): string {
  if (fraction == null || Number.isNaN(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}
