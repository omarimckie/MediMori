import { getMarketingTimezone } from "./config";

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

function partsKey(parts: ZonedParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

/**
 * Interpret a datetime-local value as wall time in the marketing timezone and return UTC ISO.
 */
export function marketingDatetimeLocalToIso(value: string, timeZone: string): string {
  const trimmed = value.trim();
  const match = DATETIME_LOCAL_PATTERN.exec(trimmed);
  if (!match) {
    throw new Error("invalid_schedule_time: Scheduled time must use YYYY-MM-DDTHH:mm.");
  }
  const target = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  if (
    target.month < 1 ||
    target.month > 12 ||
    target.day < 1 ||
    target.day > 31 ||
    target.hour > 23 ||
    target.minute > 59
  ) {
    throw new Error("invalid_schedule_time: Scheduled time is out of range.");
  }

  let utcMs = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const observed = zonedParts(new Date(utcMs), timeZone);
    if (partsKey(observed) === partsKey(target)) {
      const iso = new Date(utcMs).toISOString();
      if (Number.isNaN(new Date(iso).getTime())) {
        throw new Error("invalid_schedule_time: Scheduled time could not be parsed.");
      }
      return iso;
    }
    const observedMinutes = observed.hour * 60 + observed.minute;
    const targetMinutes = target.hour * 60 + target.minute;
    const dayOffset =
      Date.UTC(target.year, target.month - 1, target.day) -
      Date.UTC(observed.year, observed.month - 1, observed.day);
    const minuteDelta = dayOffset / (24 * 60 * 60 * 1000) * 24 * 60 + (targetMinutes - observedMinutes);
    utcMs += minuteDelta * 60 * 1000;
  }
  throw new Error("invalid_schedule_time: Scheduled time could not be converted for the marketing timezone.");
}

/** Format an instant for `<input type="datetime-local">` in the marketing timezone. */
export function isoToMarketingDatetimeLocal(iso: string | null | undefined, timeZone: string): string {
  if (!iso?.trim()) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function formatMarketingScheduleDisplay(
  iso: string | null | undefined,
  timeZone: string,
): string {
  if (!iso?.trim()) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** Calendar grouping key (YYYY-MM-DD) in the marketing timezone. */
export function calendarDayKeyInMarketingTimezone(iso: string, timeZone: string): string {
  const parts = zonedParts(new Date(iso), timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function marketingZonedYmd(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = zonedParts(date, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

/** 0 = Sunday … 6 = Saturday, in the marketing timezone. */
export function marketingWeekdaySunday0(iso: string, timeZone: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const order: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return order[name] ?? 0;
}

export function dayKeyFromYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  deltaDays: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function marketingDatetimeLocalFromParts(parts: ZonedParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

/**
 * Next strictly-future instant for recycle scheduling, using today's marketing-local date
 * and preserving the previous scheduled time-of-day when available.
 */
export function nextFutureRecycleScheduleIso(
  previousScheduledIso: string | null | undefined,
  now: Date,
  timeZone: string,
): string {
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) {
    throw new Error("invalid_schedule_time: Current time is not valid.");
  }

  let hour: number;
  let minute: number;
  if (previousScheduledIso?.trim()) {
    const previous = new Date(previousScheduledIso);
    if (Number.isNaN(previous.getTime())) {
      throw new Error("invalid_schedule_time: Previous scheduled time is not valid.");
    }
    const previousParts = zonedParts(previous, timeZone);
    hour = previousParts.hour;
    minute = previousParts.minute;
  } else {
    const nowParts = zonedParts(now, timeZone);
    hour = nowParts.hour;
    minute = nowParts.minute;
  }

  const today = zonedParts(now, timeZone);
  let year = today.year;
  let month = today.month;
  let day = today.day;

  const candidateIso = () =>
    marketingDatetimeLocalToIso(
      marketingDatetimeLocalFromParts({ year, month, day, hour, minute }),
      timeZone,
    );

  let candidateMs = new Date(candidateIso()).getTime();
  let guard = 0;
  while (candidateMs <= nowMs) {
    guard += 1;
    if (guard > 800) {
      throw new Error("invalid_schedule_time: Could not find a future recycle time.");
    }
    const nextDay = addCalendarDays(year, month, day, 1);
    year = nextDay.year;
    month = nextDay.month;
    day = nextDay.day;
    candidateMs = new Date(candidateIso()).getTime();
  }

  return new Date(candidateMs).toISOString();
}

/** Default `<input type="datetime-local">` value for recycle mode in the marketing timezone. */
export function defaultRecycleScheduleDatetimeLocal(
  previousScheduledIso: string | null | undefined,
  now: Date,
  timeZone: string,
): string {
  return isoToMarketingDatetimeLocal(
    nextFutureRecycleScheduleIso(previousScheduledIso, now, timeZone),
    timeZone,
  );
}

export function isPublicationDue(
  scheduledFor: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!scheduledFor?.trim()) return true;
  const at = new Date(scheduledFor).getTime();
  if (Number.isNaN(at)) return false;
  return at <= now.getTime();
}

/**
 * Parse schedule input from the admin UI (marketing-local datetime) or an ISO string.
 */
export function parseMarketingScheduleInput(
  value: string,
  timeZone: string = getMarketingTimezone(),
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("invalid_schedule_time: Scheduled date and time are required.");
  }
  if (DATETIME_LOCAL_PATTERN.test(trimmed)) {
    return marketingDatetimeLocalToIso(trimmed, timeZone);
  }
  const asDate = new Date(trimmed);
  if (Number.isNaN(asDate.getTime())) {
    throw new Error("invalid_schedule_time: Scheduled time is not a valid date.");
  }
  return asDate.toISOString();
}

export function resolveScheduleInstant(
  content: { scheduledFor: string | null; timezone: string },
  explicit?: string | null,
): string {
  if (explicit !== undefined && explicit !== null && explicit.trim()) {
    return parseMarketingScheduleInput(explicit, content.timezone || getMarketingTimezone());
  }
  if (content.scheduledFor?.trim()) {
    return content.scheduledFor;
  }
  return new Date().toISOString();
}
