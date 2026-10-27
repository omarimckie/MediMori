import type { ContentStatus } from "./types";

/** Statuses omitted from the normal Marketing Week working / approval feed. */
export const WEEK_WORKING_QUEUE_EXCLUDE_STATUSES: ContentStatus[] = ["rejected"];

export const PERMANENT_DELETE_CONFIRMATION = "DELETE_PERMANENTLY";

export function isPermanentDeleteConfirmed(value: unknown): boolean {
  return value === PERMANENT_DELETE_CONFIRMATION;
}

export function parseExcludeStatusQuery(value: string | null): ContentStatus[] | undefined {
  if (!value?.trim()) return undefined;
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean) as ContentStatus[];
}
