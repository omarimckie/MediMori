import assert from "node:assert/strict";
import { test } from "node:test";
import { campaignCta, resolveSmartUploadCaptionCta } from "./smart-upload-caption-cta";
import type { MarketingCampaign } from "./types";

function sampleCampaign(cta: string | null): MarketingCampaign {
  return {
    id: "camp-1",
    name: "Test",
    objective: "obj",
    status: "active",
    primaryAudience: "parents",
    secondaryAudience: null,
    coreMessage: "core",
    contentThemes: [],
    channelDistribution: {},
    recommendedFrequency: {},
    cta,
    requiredAssets: [],
    measurementGoals: [],
    bookIds: ["book-one"],
    startOn: null,
    endOn: null,
    createdBy: null,
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test("campaign CTA overrides model CTA", () => {
  const cta = resolveSmartUploadCaptionCta(
    {
      explicitCta: null,
      campaign: sampleCampaign("Campaign CTA here"),
      bookId: "book-one",
      modelInstagramCta: "Model CTA",
      modelFacebookCta: "Model CTA",
      modelSharedCta: null,
    },
    "instagram",
  );
  assert.equal(cta, "Campaign CTA here");
});

test("explicit CTA overrides campaign CTA", () => {
  const cta = resolveSmartUploadCaptionCta(
    {
      explicitCta: "Explicit wins",
      campaign: sampleCampaign("Campaign CTA"),
      bookId: null,
      modelInstagramCta: null,
      modelFacebookCta: null,
      modelSharedCta: null,
    },
    "facebook",
  );
  assert.equal(cta, "Explicit wins");
});

test("book context CTA used when no campaign or model", () => {
  const cta = resolveSmartUploadCaptionCta(
    {
      explicitCta: null,
      campaign: null,
      bookId: "book-one",
      modelInstagramCta: null,
      modelFacebookCta: null,
      modelSharedCta: null,
    },
    "instagram",
  );
  assert.match(cta ?? "", /twilight-feather\.com/);
});

test("campaignCta trims empty to null", () => {
  assert.equal(campaignCta(sampleCampaign("  ")), null);
});
