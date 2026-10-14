const dateTime = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });
const relative = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTime.format(new Date(value)) : "—";
}

export function formatDate(value: string | null | undefined): string {
  return value ? dateOnly.format(new Date(value)) : "—";
}

export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "Nunca";
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "hace un momento";
}

export function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

/** Date-only values ("YYYY-MM-DD") are calendar days: never shift them by time zone. */
export function parseDay(value: string): Date {
  return new Date(`${value.slice(0, 10)}T12:00:00`);
}

export function formatDay(value: string | null | undefined): string {
  return value ? dateOnly.format(parseDay(value)) : "—";
}

const monthFormat = new Intl.DateTimeFormat("es-MX", { month: "short", year: "numeric" });
const monthLong = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" });

export function formatMonth(value: string, long = false): string {
  return (long ? monthLong : monthFormat).format(parseDay(value));
}

const moneyFormats = new Map<string, Intl.NumberFormat>();

/**
 * Money arrives from the API as decimal strings; it is only converted to a number to be
 * displayed (all calculations happen on the server with Decimal).
 */
export function formatMoney(value: string | number | null | undefined, currency = "MXN", compact = false): string {
  if (value === null || value === undefined || value === "") return "—";
  const key = `${currency}-${compact}`;
  let fmt = moneyFormats.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : { minimumFractionDigits: 2 }),
    });
    moneyFormats.set(key, fmt);
  }
  return fmt.format(Number(value));
}

export function formatPercent(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "N/A";
  return `${Number(value).toLocaleString("es-MX", { maximumFractionDigits: 2 })} %`;
}

/** Local calendar day as "YYYY-MM-DD". */
export function toIsoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
