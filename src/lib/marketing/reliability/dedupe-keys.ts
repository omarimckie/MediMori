export function publicationOverdueDedupeKey(publicationId: string): string {
  return `publication_overdue:v1:${publicationId}`;
}

export function publicationAmbiguousProcessingDedupeKey(publicationId: string): string {
  return `publication_ambiguous:processing:v1:${publicationId}`;
}
