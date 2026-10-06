import type { MarketingPublication } from "../types";
import {
  PUBLICATION_OVERDUE_THRESHOLD_MS,
  PUBLICATION_STUCK_PROCESSING_THRESHOLD_MS,
} from "./constants";

export function isPublicationOverdue(
  publication: MarketingPublication,
  now: Date,
  thresholdMs = PUBLICATION_OVERDUE_THRESHOLD_MS,
): boolean {
  if (publication.status !== "scheduled") return false;
  if (!publication.scheduledFor) return false;
  const dueAt = new Date(publication.scheduledFor).getTime();
  if (!Number.isFinite(dueAt)) return false;
  return now.getTime() - dueAt >= thresholdMs;
}

export function isPublicationStuckProcessing(
  publication: MarketingPublication,
  now: Date,
  thresholdMs = PUBLICATION_STUCK_PROCESSING_THRESHOLD_MS,
): boolean {
  if (publication.status !== "processing") return false;
  const updatedAt = new Date(publication.updatedAt).getTime();
  if (!Number.isFinite(updatedAt)) return false;
  return now.getTime() - updatedAt >= thresholdMs;
}

export function filterOverduePublications(
  publications: MarketingPublication[],
  now: Date,
  thresholdMs = PUBLICATION_OVERDUE_THRESHOLD_MS,
): MarketingPublication[] {
  return publications.filter((row) => isPublicationOverdue(row, now, thresholdMs));
}

export function filterStuckProcessingPublications(
  publications: MarketingPublication[],
  now: Date,
  thresholdMs = PUBLICATION_STUCK_PROCESSING_THRESHOLD_MS,
): MarketingPublication[] {
  return publications.filter((row) => isPublicationStuckProcessing(row, now, thresholdMs));
}
