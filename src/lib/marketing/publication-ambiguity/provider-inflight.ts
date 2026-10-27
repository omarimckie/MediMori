/** Sentinel stored in provider_creation_id for atomic provider-entry (not a Meta id). */
export const PUBLICATION_PROVIDER_INFLIGHT_MARKER = "__publish_inflight__";

export function isProviderInflightMarker(
  providerCreationId: string | null | undefined,
): boolean {
  return providerCreationId === PUBLICATION_PROVIDER_INFLIGHT_MARKER;
}

export function isPersistedProviderCreationId(
  providerCreationId: string | null | undefined,
): boolean {
  if (!providerCreationId) return false;
  return !isProviderInflightMarker(providerCreationId);
}
