import {
  APPROVED_CLAIMS,
  CTA_RULES,
  defaultTemplates,
  promotionalRules,
  RESTRICTED_CLAIMS,
} from "./brain";
import { DEFAULT_CHANNEL_QUOTAS } from "./config";
import { ensureCatalogAssets } from "./assets";
import { generateWeeklyContent } from "./content-engine";
import { buildWeeklyPlan, createCampaignFromObjective } from "./planner";
import { generateRecommendations } from "./recommendations";
import type { MarketingStore } from "./store";

export async function seedMarketing(store: MarketingStore) {
  const existingCampaigns = await store.listCampaigns();
  if (existingCampaigns.some((item) => item.isDemo)) {
    return { seeded: false, reason: "Demo data already present." };
  }

  await store.setSetting("channel_quotas", DEFAULT_CHANNEL_QUOTAS);
  await ensureCatalogAssets(store);

  const templates = await store.listTemplates();
  if (!templates.length) {
    for (const template of defaultTemplates()) {
      await store.createTemplate(template);
    }
  }

  if (!(await store.listRules()).length) {
    for (const claim of APPROVED_CLAIMS) {
      await store.addRule({
        id: crypto.randomUUID(),
        kind: "approved_claim",
        title: claim.id,
        body: claim.body,
        bookId: claim.bookId ?? null,
        active: true,
        origin: "seed",
      });
    }
    for (const body of RESTRICTED_CLAIMS) {
      await store.addRule({
        id: crypto.randomUUID(),
        kind: "restricted_claim",
        title: "restricted",
        body,
        bookId: null,
        active: true,
        origin: "seed",
      });
    }
    await store.addRule({
      id: crypto.randomUUID(),
      kind: "cta",
      title: "default-cta",
      body: CTA_RULES.default,
      bookId: null,
      active: true,
      origin: "seed",
    });
    await store.addRule({
      id: crypto.randomUUID(),
      kind: "promo",
      title: "ebook-discount",
      body: CTA_RULES.ebookDiscount,
      bookId: null,
      active: true,
      origin: "seed",
    });
    for (const body of promotionalRules()) {
      await store.addRule({
        id: crypto.randomUUID(),
        kind: "promo",
        title: "promo",
        body,
        bookId: null,
        active: true,
        origin: "seed",
      });
    }
    await store.addRule({
      id: crypto.randomUUID(),
      kind: "quota",
      title: "weekly-channel-quotas",
      body: JSON.stringify(DEFAULT_CHANNEL_QUOTAS),
      bookId: null,
      active: true,
      origin: "seed",
    });
  }

  await store.addPreference({
    id: crypto.randomUUID(),
    category: "tone",
    statement: "Keep copy warm and conversational; avoid clinical openings.",
    source: "owner_confirmed",
    strength: "owner_confirmed",
    active: true,
    ownerConfirmed: true,
  });
  await store.addPreference({
    id: crypto.randomUUID(),
    category: "cta",
    statement: "Prefer a read-together invitation over hard sell.",
    source: "owner_confirmed",
    strength: "owner_confirmed",
    active: true,
    ownerConfirmed: true,
  });

  const campaign = await createCampaignFromObjective(store, {
    objective: "Promote the Sickle Cell book for 30 days.",
    actor: "seed",
  });
  await store.updateCampaign(campaign.id, { isDemo: true, status: "active" });
  const demoCampaign = (await store.getCampaign(campaign.id)) ?? campaign;
  const plan = await buildWeeklyPlan(store, demoCampaign);
  const quotas = DEFAULT_CHANNEL_QUOTAS;
  const content = await generateWeeklyContent(store, demoCampaign, plan, quotas);

  const publishable = content.filter((item) => item.platform === "pinterest").slice(0, 2);
  for (const item of publishable) {
    await store.updateContent(item.id, { status: "published" });
    await store.createPublication({
      id: crypto.randomUUID(),
      contentId: item.id,
      campaignId: campaign.id,
      platform: item.platform,
      provider: "mock_social",
      status: "published",
      idempotencyKey: `seed:${item.id}`,
      externalId: `seed_${item.id}`,
      url: `https://mock.local/pinterest/${item.id}`,
      attemptCount: 1,
      lastError: null,
      scheduledFor: item.scheduledFor,
      publishedAt: new Date().toISOString(),
    });
    await store.upsertMetric({
      id: crypto.randomUUID(),
      contentId: item.id,
      campaignId: campaign.id,
      platform: item.platform,
      metricDate: new Date().toISOString().slice(0, 10),
      impressions: 120,
      engagements: 18,
      clicks: 4,
      emailOpens: 0,
      emailClicks: 0,
      websiteSessions: 3,
      bookPageViews: 3,
      attributedPurchases: 0,
      source: "mock",
    });
  }

  await generateRecommendations(store, campaign.id);

  return {
    seeded: true,
    campaignId: campaign.id,
    planId: plan.id,
    contentCount: content.length,
    note: "Demo seed. Campaign facts come from the catalog; metrics are labeled mock.",
  };
}
