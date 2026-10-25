import type { AttributionRow } from "../attribution";

/** Attribution rows for admin UI: no purchase ids or payment fields. */
export type SanitizedAttributionRow = {
  bookId: string;
  kind: AttributionRow["kind"];
  reason: string;
  campaignId: string | null;
  contentId: string | null;
};

export function sanitizeAttributionRows(rows: AttributionRow[]): SanitizedAttributionRow[] {
  return rows.map((row) => ({
    bookId: row.bookId,
    kind: row.kind,
    reason: row.reason,
    campaignId: row.campaignId,
    contentId: row.contentId,
  }));
}

export const MARKETING_ANALYTICS_PRIVACY_NOTE =
  "Aggregates only. Purchase rows never include customer email, name, or payment identifiers.";
