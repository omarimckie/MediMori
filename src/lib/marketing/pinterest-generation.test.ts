import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CHANNEL_QUOTAS } from "./config";
import { generateWeeklyContent } from "./content-engine";
import { selectAssetWithTruths } from "./asset-selection";
import { buildWeeklyPlan, getChannelQuotas } from "./planner";
import { createCampaignWorkflow } from "./workflow";
import { ensureCatalogAssets } from "./assets";
import { MemoryMarketingStore } from "./memory-store";
import { truthFromDimensions } from "./asset-truth";
import { isAssetSuitableForPlatform } from "./platform-suitability";
import { pinterestCopyFor, pinterestTitleFor } from "./pinterest-generation";
import type { MarketingAsset, MarketingCampaign } from "./types";

function asset(overrides: Partial<MarketingAsset> & Pick<MarketingAsset, "id" | "type" | "url">): MarketingAsset {
  return {
    name: overrides.name ?? overrides.id,
    source: "catalog",
    bookId: overrides.bookId ?? "book-one",
    characterId: overrides.characterId ?? null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: overrides.aspectRatio ?? null,
    imageWidth: overrides.imageWidth ?? null,
    imageHeight: overrides.imageHeight ?? null,
    mimeType: overrides.mimeType ?? "image/png",
    tags: [],
    altText: null,
    isDemo: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function truthsFor(assets: MarketingAsset[]) {
  const map = new Map<string, ReturnType<typeof truthFromDimensions> | null>();
  for (const a of assets) {
    if (a.imageWidth && a.imageHeight) {
      map.set(a.id, truthFromDimensions(a.imageWidth, a.imageHeight, a.mimeType ?? "image/png"));
    } else {
      map.set(a.id, null);
    }
  }
  return map;
}

const sampleCampaign: MarketingCampaign = {
  id: "camp",
  name: "Test",
  objective: "Promote sickle cell book",
  bookIds: ["book-one"],
  primaryAudience: "parents",
  secondaryAudience: "schools",
  coreMessage: "Gentle sickle cell stories for families.",
  contentThemes: [],
  channelDistribution: {},
  recommendedFrequency: {},
  cta: null,
  requiredAssets: [],
  measurementGoals: [],
  startOn: null,
  endOn: null,
  createdBy: null,
  status: "active",
  isDemo: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

test("default channel quota sets pinterest to 3", () => {
  assert.equal(DEFAULT_CHANNEL_QUOTAS.pinterest, 3);
  assert.equal(DEFAULT_CHANNEL_QUOTAS.instagram, 5);
});

test("pinterest titles differ by category angle", () => {
  const educational = pinterestTitleFor({
    category: "educational",
    bookTitle: "Children Diseases: Sickle Cell",
    characterName: "Amara",
    index: 0,
  });
  const conversation = pinterestTitleFor({
    category: "engagement",
    bookTitle: "Children Diseases: Sickle Cell",
    characterName: "Amara",
    index: 0,
  });
  const discovery = pinterestTitleFor({
    category: "product_feature",
    bookTitle: "Children Diseases: Sickle Cell",
    characterName: "Amara",
    index: 0,
  });
  assert.match(educational, /What Is Sickle Cell/i);
  assert.match(conversation, /Talking to Your Child/i);
  assert.match(discovery, /Meet Amara/i);
  assert.notEqual(educational, conversation);
  assert.notEqual(conversation, discovery);
});

test("pinterest copy does not use the legacy audience conversation-starter title", () => {
  for (const category of ["educational", "engagement", "product_feature"] as const) {
    const copy = pinterestCopyFor({
      campaign: sampleCampaign,
      category,
      audience: "parents",
      bookTitle: "Children Diseases: Sickle Cell",
      bookId: "book-one",
      characterName: "Amara",
      index: 0,
    });
    assert.doesNotMatch(copy.title, /gentle conversation starter for/i);
  }
});

test("weekly generation creates three distinct pinterest pins", async () => {
  const store = new MemoryMarketingStore();
  const campaign = await createCampaignWorkflow(store, "Promote the Sickle Cell book for 30 days.");
  await ensureCatalogAssets(store);
  const plan = await buildWeeklyPlan(store, campaign);
  const quotas = await getChannelQuotas(store);
  const content = await generateWeeklyContent(store, campaign, plan, quotas);
  const pinterest = content.filter((item) => item.platform === "pinterest");
  assert.equal(pinterest.length, 3);
  const categories = pinterest.map((item) => item.category).sort();
  assert.deepEqual(categories, ["educational", "engagement", "product_feature"].sort());
  const titles = new Set(pinterest.map((item) => item.title));
  assert.equal(titles.size, 3);
});

test("instagram generation still assigns cover when suitable", async () => {
  const store = new MemoryMarketingStore();
  const campaign = await createCampaignWorkflow(store, "Promote the Sickle Cell book for 30 days.");
  await ensureCatalogAssets(store);
  const plan = await buildWeeklyPlan(store, campaign);
  const quotas = await getChannelQuotas(store);
  const content = await generateWeeklyContent(store, campaign, plan, quotas);
  const instagram = content.filter((item) => item.platform === "instagram");
  const assets = await store.listAssets();
  const assetById = new Map(assets.map((a) => [a.id, a]));
  for (const item of instagram) {
    const linked = item.assetIds.map((id) => assetById.get(id)).find(Boolean);
    assert.ok(linked);
    assert.equal(linked?.type, "cover");
  }
});

test("pinterest prefers suitable vertical asset over square cover", () => {
  const cover = asset({
    id: "cover",
    type: "cover",
    url: "/covers/sickle-cell.png",
    imageWidth: 1009,
    imageHeight: 1024,
  });
  const vertical = asset({
    id: "vertical",
    type: "character",
    url: "/characters/Amara/amara-sitting_with_books.PNG",
    characterId: "amara",
    imageWidth: 1024,
    imageHeight: 1536,
  });
  const truths = truthsFor([cover, vertical]);
  assert.equal(isAssetSuitableForPlatform(truths.get("cover")!, "pinterest", "pin"), false);
  assert.equal(isAssetSuitableForPlatform(truths.get("vertical")!, "pinterest", "pin"), true);

  const chosen = selectAssetWithTruths([cover, vertical], truths, {
    bookId: "book-one",
    characterId: "amara",
    platform: "pinterest",
    format: "pin",
    category: "educational",
  });
  assert.equal(chosen.asset?.id, "vertical");
  assert.equal(chosen.needsNewAsset, false);
});

test("pinterest does not assign the same asset to all three pins when alternatives exist", () => {
  const cover = asset({
    id: "cover",
    type: "cover",
    url: "/covers/sickle-cell.png",
    imageWidth: 1009,
    imageHeight: 1024,
  });
  const charA = asset({
    id: "char-a",
    type: "character",
    url: "/characters/Amara/a.png",
    characterId: "amara",
    imageWidth: 1024,
    imageHeight: 1536,
  });
  const charB = asset({
    id: "char-b",
    type: "character",
    url: "/characters/Amara/b.png",
    characterId: "amara",
    imageWidth: 800,
    imageHeight: 1200,
  });
  const interior = asset({
    id: "interior",
    type: "interior",
    url: "/interior/page.png",
    imageWidth: 1024,
    imageHeight: 1536,
  });
  const assets = [cover, charA, charB, interior];
  const truths = truthsFor(assets);
  const used: string[] = [];
  const picks: string[] = [];
  for (const category of ["educational", "engagement", "product_feature"] as const) {
    const chosen = selectAssetWithTruths(assets, truths, {
      bookId: "book-one",
      characterId: "amara",
      platform: "pinterest",
      format: "pin",
      category,
      excludeAssetIds: [...used],
    });
    assert.ok(chosen.asset);
    picks.push(chosen.asset.id);
    used.push(chosen.asset.id);
  }
  assert.equal(new Set(picks).size, 3);
  assert.equal(picks.includes("cover"), false);
});

test("pinterest marks needsNewAsset when only unsuitable square cover exists", () => {
  const cover = asset({
    id: "cover",
    type: "cover",
    url: "/covers/sickle-cell.png",
    imageWidth: 1009,
    imageHeight: 1024,
  });
  const truths = truthsFor([cover]);
  const chosen = selectAssetWithTruths([cover], truths, {
    bookId: "book-one",
    characterId: "amara",
    platform: "pinterest",
    format: "pin",
    category: "educational",
  });
  assert.equal(chosen.asset, null);
  assert.equal(chosen.needsNewAsset, true);
});
