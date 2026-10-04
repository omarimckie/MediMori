import { addDays, mondayOf, toDateOnly } from "./json";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type MarketingWeekTiming = "past" | "current" | "upcoming";

/**
 * Marketing weeks use UTC date-only boundaries: Monday 00:00 UTC through Sunday (inclusive).
 */
export function marketingUtcToday(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export class WeeklyPlanDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeeklyPlanDateError";
  }
}

export function parseMarketingDateOnly(value: unknown): string {
  if (typeof value !== "string" || !DATE_ONLY.test(value)) {
    throw new WeeklyPlanDateError("weekStart must be a valid date in YYYY-MM-DD format.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new WeeklyPlanDateError("weekStart must be a valid calendar date.");
  }
  const normalized = toDateOnly(parsed);
  if (normalized !== value) {
    throw new WeeklyPlanDateError("weekStart must be a valid calendar date.");
  }
  return value;
}

/** Map any date in a calendar week to that week's Monday (UTC). */
export function normalizeToWeekMonday(dateOnly: string): string {
  parseMarketingDateOnly(dateOnly);
  return mondayOf(new Date(`${dateOnly}T00:00:00.000Z`));
}

/**
 * Default week start for “New Week”: the next operational Monday in UTC.
 * - Sunday → tomorrow (Monday)
 * - Monday → today
 * - Tuesday–Saturday → the following Monday
 */
export function nextMondayDefault(date = new Date()): string {
  const today = marketingUtcToday(date);
  const dow = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  if (dow === 0) {
    return addDays(today, 1);
  }
  if (dow === 1) {
    return today;
  }
  const daysUntilNextMonday = 8 - dow;
  return addDays(today, daysUntilNextMonday);
}

export function classifyMarketingWeek(
  weekStart: string,
  today = marketingUtcToday(),
): MarketingWeekTiming {
  parseMarketingDateOnly(weekStart);
  const weekEnd = addDays(weekStart, 6);
  if (today < weekStart) return "upcoming";
  if (today > weekEnd) return "past";
  return "current";
}

export function formatMarketingWeekTimingLabel(timing: MarketingWeekTiming): string {
  if (timing === "past") return "Past";
  if (timing === "current") return "Current";
  return "Upcoming";
}
