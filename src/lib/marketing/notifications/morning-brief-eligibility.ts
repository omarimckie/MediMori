import type { MorningBriefPreferences } from "./types";
import { calendarDayInTimezone } from "./morning-brief";

export const MORNING_BRIEF_DELIVERY_WINDOW_END_LOCAL_HOUR = 24;

export type ZonedLocalTime = {
  calendarDate: string;
  hour: number;
  minute: number;
  minutesSinceMidnight: number;
};

export function parseMorningBriefClockTime(time: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function zonedLocalTime(date: Date, timeZone: string): ZonedLocalTime {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return {
    calendarDate: calendarDayInTimezone(date, timeZone),
    hour,
    minute,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

export function morningBriefDedupeKey(timeZone: string, localDate: string): string {
  return `morning_brief:v1:${timeZone}:${localDate}`;
}

export function isMorningBriefDeliveryEligible(
  now: Date,
  prefs: MorningBriefPreferences,
): { eligible: false; reason: string } | { eligible: true; localDate: string; dedupeKey: string } {
  if (!prefs.morningBriefEnabled) {
    return { eligible: false, reason: "morning_brief_disabled" };
  }

  const clock = parseMorningBriefClockTime(prefs.morningBriefTime);
  if (!clock) {
    return { eligible: false, reason: "invalid_morning_brief_time" };
  }

  const local = zonedLocalTime(now, prefs.timezone);
  const targetMinutes = clock.hour * 60 + clock.minute;
  if (local.minutesSinceMidnight < targetMinutes) {
    return { eligible: false, reason: "before_delivery_time" };
  }

  return {
    eligible: true,
    localDate: local.calendarDate,
    dedupeKey: morningBriefDedupeKey(prefs.timezone, local.calendarDate),
  };
}
