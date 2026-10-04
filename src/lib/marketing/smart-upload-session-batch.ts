/** Assigned after mount so SSR and hydration do not diverge on random IDs. */
export const SMART_UPLOAD_SESSION_BATCH_ID_UNASSIGNED = null;

export function createSmartUploadSessionBatchId(): string {
  return crypto.randomUUID();
}
