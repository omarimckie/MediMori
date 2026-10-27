import { catalogBooks } from "./brain";
import { attributePurchases, loadPurchaseSnapshots } from "./attribution";
import type { MarketingStore } from "./store";
import type { EvidenceStrength } from "./types";

export async function generateRecommendations(store: MarketingStore, campaignId?: string) {
  const content = campaignId
    ? await store.listContent({ campaignId })
    : await store.listContent();
  const metrics = campaignId ? await store.listMetrics(campaignId) : await store.listMetrics();
  const purchases = await loadPurchaseSnapshots();
  const attributed = await attributePurchases(store, purchases);
  const existing = await store.listRecommendations();

  const created = [];

  const rejectedTrust = content.filter(
    (item) => item.category === "trust" && item.status === "rejected",
  );
  if (rejectedTrust.length && !existing.some((item) => item.title === "Pause unverified trust posts")) {
    created.push(
      await store.createRecommendation({
        id: crypto.randomUUID(),
        campaignId: campaignId ?? content[0]?.campaignId ?? null,
        title: "Pause unverified trust posts",
        recommendation:
          "Keep trust/credibility items in the playbook, but only generate them when an owner-approved review or organization is on file.",
        reason: "Trust items were rejected. Invented social proof is not allowed.",
        supportingData: { rejectedTrust: rejectedTrust.length },
        evidenceStrength: "supporting" satisfies EvidenceStrength,
        status: "open",
        decidedAt: null,
      }),
    );
  }

  const conversions = content.filter((item) => item.category === "conversion");
  const conversionApprovals = conversions.filter((item) => item.status === "approved" || item.status === "published");
  if (conversionApprovals.length && conversions.length) {
    const title = "Keep ebook CTAs specific";
    if (!existing.some((item) => item.title === title)) {
      created.push(
        await store.createRecommendation({
          id: crypto.randomUUID(),
          campaignId: campaignId ?? null,
          title,
          recommendation:
            "Continue using ebook-only discount language on conversion posts. Do not expand the code to paperbacks unless the website data changes.",
          reason: "Conversion items that stayed inside the ebook rule were approvable.",
          supportingData: { approvedConversion: conversionApprovals.length },
          evidenceStrength: "limited",
          status: "open",
          decidedAt: null,
        }),
      );
    }
  }

  const top = [...metrics].sort((a, b) => b.engagements - a.engagements)[0];
  if (top?.contentId) {
    const item = content.find((entry) => entry.id === top.contentId);
    const title = "Repeat the higher-engagement category";
    if (item && !existing.some((entry) => entry.title === title)) {
      created.push(
        await store.createRecommendation({
          id: crypto.randomUUID(),
          campaignId: item.campaignId,
          title,
          recommendation: `Consider more ${item.category.replace("_", " ")} content next week on ${item.platform}. This is a recommendation, not an automatic strategy change.`,
          reason: "This item has the highest recorded engagement in the current metric set.",
          supportingData: { engagements: top.engagements, platform: item.platform, source: top.source },
          evidenceStrength: top.source === "mock" ? "limited" : "supporting",
          status: "open",
          decidedAt: null,
        }),
      );
    }
  }

  const sicklePurchases = purchases.filter((item) => item.bookId === "book-one").length;
  const sickleBook = catalogBooks().find((book) => book.id === "book-one");
  if (sicklePurchases && sickleBook && !existing.some((item) => item.title.includes("Sickle Cell"))) {
    created.push(
      await store.createRecommendation({
        id: crypto.randomUUID(),
        campaignId: campaignId ?? null,
        title: "Promote Sickle Cell with parent-first educational posts",
        recommendation: `Use ${sickleBook.title} educational and character stories before conversion posts. Purchases exist; they are not automatically campaign-attributed.`,
        reason: "The existing purchase table shows book-one activity. Attribution remains mixed until tracking clicks are present.",
        supportingData: {
          sicklePurchases,
          directlyAttributed: attributed.filter((row) => row.kind === "directly_attributed").length,
          assisted: attributed.filter((row) => row.kind === "assisted").length,
        },
        evidenceStrength: "supporting",
        status: "open",
        decidedAt: null,
      }),
    );
  }

  for (const rec of created) {
    await store.recordEvent({
      id: crypto.randomUUID(),
      name: "recommendation_generated",
      campaignId: rec.campaignId,
      contentId: null,
      platform: null,
      properties: { title: rec.title, evidenceStrength: rec.evidenceStrength },
    });
  }

  return store.listRecommendations();
}

export async function decideRecommendation(
  store: MarketingStore,
  id: string,
  status: "accepted" | "rejected" | "dismissed",
) {
  const updated = await store.updateRecommendation(id, {
    status,
    decidedAt: new Date().toISOString(),
  });
  await store.recordEvent({
    id: crypto.randomUUID(),
    name: status === "accepted" ? "recommendation_accepted" : "recommendation_rejected",
    campaignId: updated?.campaignId ?? null,
    contentId: null,
    platform: null,
    properties: { recommendationId: id, status },
  });
  return updated;
}
