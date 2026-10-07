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

export function publicationFailedIncidentDedupeKey(publicationId: string): string {
  return `incident:publication_failed:v1:${publicationId}`;
}

export function publicationFailedNotificationDedupeKey(publicationId: string): string {
  return `publication_failed:notify:v1:${publicationId}`;
}

export function smartUploadCaptionFailedIncidentDedupeKey(finalizeKey: string): string {
  return `incident:smart_upload_caption_failed:v1:${finalizeKey}`;
}

export function smartUploadFinalizeFailedIncidentDedupeKey(finalizeKey: string): string {
  return `incident:smart_upload_finalize_failed:v1:${finalizeKey}`;
}
