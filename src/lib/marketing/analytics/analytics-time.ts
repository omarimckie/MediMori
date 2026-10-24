import { getMarketingTimezone } from "../config";

export function calendarDayInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

export function previousCalendarDayKey(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const yy = prev.getUTCFullYear();
  const mm = String(prev.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(prev.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export type AnalyticsReportingWindow = "day" | "week" | "month";

export type AnalyticsReportingPeriod = {
  window: AnalyticsReportingWindow;
  timezone: string;
  /** Inclusive local calendar days (YYYY-MM-DD) in marketing timezone. */
  dayKeys: string[];
  startDayKey: string;
  endDayKey: string;
  label: string;
};

function parseDayKey(dayKey: string): { y: number; m: number; d: number } {
  const [y, m, d] = dayKey.split("-").map(Number);
  return { y, m, d };
}

function addCalendarDays(dayKey: string, delta: number): string {
  const { y, m, d } = parseDayKey(dayKey);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function mondayOfWeekContaining(dayKey: string): string {
  const { y, m, d } = parseDayKey(dayKey);
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return addCalendarDays(dayKey, mondayOffset);
}

function daysInMonth(dayKey: string): string[] {
  const { y, m } = parseDayKey(dayKey);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prefix = `${y}-${String(m).padStart(2, "0")}`;
  const keys: string[] = [];
  for (let d = 1; d <= last; d += 1) {
    keys.push(`${prefix}-${String(d).padStart(2, "0")}`);
  }
  return keys;
}

export function resolveAnalyticsReportingPeriod(
  window: AnalyticsReportingWindow,
  anchor: Date = new Date(),
  timezone = getMarketingTimezone(),
): AnalyticsReportingPeriod {
  const anchorKey = calendarDayInTimezone(anchor, timezone);
  let dayKeys: string[] = [];
  let label = anchorKey;

  if (window === "day") {
    dayKeys = [anchorKey];
    label = anchorKey;
  } else if (window === "week") {
    const start = mondayOfWeekContaining(anchorKey);
    dayKeys = Array.from({ length: 7 }, (_, i) => addCalendarDays(start, i));
    label = `${dayKeys[0]} – ${dayKeys[6]}`;
  } else {
    dayKeys = daysInMonth(anchorKey);
    const { y, m } = parseDayKey(anchorKey);
    label = `${y}-${String(m).padStart(2, "0")}`;
  }

  return {
    window,
    timezone,
    dayKeys,
    startDayKey: dayKeys[0] ?? anchorKey,
    endDayKey: dayKeys[dayKeys.length - 1] ?? anchorKey,
    label,
  };
}

export function eventDayKey(iso: string, timezone: string): string {
  return calendarDayInTimezone(new Date(iso), timezone);
}

export function isDayKeyInPeriod(dayKey: string, period: AnalyticsReportingPeriod): boolean {
  return period.dayKeys.includes(dayKey);
}
