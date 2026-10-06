/** Scheduled publications overdue when still scheduled this long after scheduled_for. */
export const PUBLICATION_OVERDUE_THRESHOLD_MS = 20 * 60 * 1000;

/** Processing publications treated as stuck/ambiguous after updated_at age. */
export const PUBLICATION_STUCK_PROCESSING_THRESHOLD_MS = 25 * 60 * 1000;

/** Existing publisher reclaim window (unchanged in Phase 1). */
export const PUBLICATION_STALE_PROCESSING_RECLAIM_MS = 15 * 60 * 1000;
