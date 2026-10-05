import type { MarketingStore } from "../store";
import {
  DEFAULT_MORNING_BRIEF_PREFERENCES,
  MORNING_BRIEF_SETTINGS_KEY,
  type MorningBriefPreferences,
} from "./types";

export function parseMorningBriefPreferences(value: unknown): MorningBriefPreferences {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_MORNING_BRIEF_PREFERENCES };
  }
  const record = value as Record<string, unknown>;
  const morningBriefEnabled =
    typeof record.morningBriefEnabled === "boolean"
      ? record.morningBriefEnabled
      : DEFAULT_MORNING_BRIEF_PREFERENCES.morningBriefEnabled;
  const morningBriefTime =
    typeof record.morningBriefTime === "string" && /^\d{2}:\d{2}$/.test(record.morningBriefTime)
      ? record.morningBriefTime
      : DEFAULT_MORNING_BRIEF_PREFERENCES.morningBriefTime;
  const timezone =
    typeof record.timezone === "string" && record.timezone.trim()
      ? record.timezone.trim()
      : DEFAULT_MORNING_BRIEF_PREFERENCES.timezone;
  return { morningBriefEnabled, morningBriefTime, timezone };
}

export async function getMorningBriefPreferences(
  store: MarketingStore,
): Promise<MorningBriefPreferences> {
  const raw = await store.getSetting(MORNING_BRIEF_SETTINGS_KEY, null);
  return parseMorningBriefPreferences(raw);
}

export async function setMorningBriefPreferences(
  store: MarketingStore,
  prefs: MorningBriefPreferences,
): Promise<MorningBriefPreferences> {
  const normalized = parseMorningBriefPreferences(prefs);
  await store.setSetting(MORNING_BRIEF_SETTINGS_KEY, normalized);
  return normalized;
}
