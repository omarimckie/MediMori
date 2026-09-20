import type { MarketingStore } from "./store";
import type { AttributionKind, PurchaseSnapshot } from "./types";

const ASSIST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type AttributionRow = {
  purchaseId: string;
  bookId: string;
  purchasedAt: string;
  kind: AttributionKind;
  campaignId: string | null;
  contentId: string | null;
  reason: string;
};

export async function attributePurchases(
  store: MarketingStore,
  purchases: PurchaseSnapshot[],
): Promise<AttributionRow[]> {
  const clicks = await store.listClicks();
  const content = await store.listContent();
  const rows: AttributionRow[] = [];

  for (const purchase of purchases) {
    const direct = clicks
      .filter((click) => click.bookId === purchase.bookId)
      .sort((a, b) => b.clickedAt.localeCompare(a.clickedAt))
      .find((click) => {
        const delta = new Date(purchase.purchasedAt).getTime() - new Date(click.clickedAt).getTime();
        return delta >= 0 && delta <= ASSIST_WINDOW_MS;
      });

    if (direct) {
      rows.push({
        purchaseId: purchase.id,
        bookId: purchase.bookId,
        purchasedAt: purchase.purchasedAt,
        kind: "directly_attributed",
        campaignId: direct.campaignId,
        contentId: direct.contentId,
        reason: "A tracked marketing click for this book happened before the purchase within 7 days.",
      });
      continue;
    }

    const relatedContent = content.filter(
      (item) =>
        item.bookId === purchase.bookId &&
        (item.status === "published" || item.status === "scheduled"),
    );
    const nearby = relatedContent.find((item) => {
      if (!item.scheduledFor) return false;
      const delta = Math.abs(
        new Date(purchase.purchasedAt).getTime() - new Date(item.scheduledFor).getTime(),
      );
      return delta <= ASSIST_WINDOW_MS;
    });

    if (nearby) {
      rows.push({
        purchaseId: purchase.id,
        bookId: purchase.bookId,
        purchasedAt: purchase.purchasedAt,
        kind: "assisted",
        campaignId: nearby.campaignId,
        contentId: nearby.id,
        reason:
          "A purchase of the promoted book occurred near published campaign activity. This is correlation, not proof.",
      });
      continue;
    }

    rows.push({
      purchaseId: purchase.id,
      bookId: purchase.bookId,
      purchasedAt: purchase.purchasedAt,
      kind: "unattributed",
      campaignId: null,
      contentId: null,
      reason: "No marketing click or nearby published content is tied to this purchase.",
    });
  }

  return rows;
}

export async function recordMockMetrics(store: MarketingStore, campaignId: string) {
  const published = await store.listContent({ campaignId, status: "published" });
  const clicks = await store.listClicks();
  for (const item of published) {
    const itemClicks = clicks.filter((click) => click.contentId === item.id).length;
    await store.upsertMetric({
      id: crypto.randomUUID(),
      contentId: item.id,
      campaignId,
      platform: item.platform,
      metricDate: new Date().toISOString().slice(0, 10),
      impressions: 40 + itemClicks * 8,
      engagements: 6 + itemClicks * 2,
      clicks: itemClicks,
      emailOpens: item.platform === "email" ? 12 : 0,
      emailClicks: item.platform === "email" ? itemClicks : 0,
      websiteSessions: itemClicks,
      bookPageViews: itemClicks,
      attributedPurchases: 0,
      source: "mock",
    });
  }
}

export async function loadPurchaseSnapshots(): Promise<PurchaseSnapshot[]> {
  try {
    const { getSql } = await import("@/lib/db");
    const sql = getSql();
    const rows = await sql`
      SELECT id, book_id, purchased_at, amount_cents
      FROM purchases
      WHERE refund_status <> 'fully_refunded'
      ORDER BY purchased_at DESC
      LIMIT 200
    `;
    return rows.map((row) => ({
      id: String(row.id),
      bookId: String(row.book_id),
      purchasedAt: new Date(String(row.purchased_at)).toISOString(),
      amountCents: row.amount_cents == null ? null : Number(row.amount_cents),
    }));
  } catch {
    return [];
  }
}
