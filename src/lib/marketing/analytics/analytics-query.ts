import type { AnalyticsReportingWindow } from "./analytics-time";

export function parseAnalyticsWindowParam(value: string | null): AnalyticsReportingWindow {
  if (value === "day" || value === "week" || value === "month") return value;
  return "week";
}

/** Anchor calendar day (UTC noon) or undefined when invalid. */
export function parseAnalyticsAnchorParam(value: string | null): Date | undefined {
  if (!value?.trim()) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return undefined;
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}
