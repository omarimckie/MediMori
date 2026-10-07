export function publicationAmbiguousIncidentDedupeKey(publicationId: string): string {
  return `incident:publication_ambiguous:v1:${publicationId}`;
}

export function publicationStuckProcessingIncidentDedupeKey(publicationId: string): string {
  return `incident:publication_stuck_processing:v1:${publicationId}`;
}

export function publicationOverdueIncidentDedupeKey(publicationId: string): string {
  return `incident:publication_overdue:v1:${publicationId}`;
}

export function publicationRecoveryRequiredIncidentDedupeKey(publicationId: string): string {
  return `incident:publication_recovery_required:v1:${publicationId}`;
}
