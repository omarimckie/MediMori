import { PLATFORM_LABELS } from "../config";
import type { Platform } from "../types";

export function formatPlatformLabel(platform: Platform): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

export function formatScheduledForEt(iso: string | null | undefined): string {
  if (!iso) return "unknown time";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
