import assert from "node:assert/strict";

import { afterEach, beforeEach, test } from "node:test";

import type { AIProvider } from "./ai";

import { MemoryMarketingStore } from "./memory-store";

import {

  issueSmartUploadIntent,

  issueSmartUploadPreviewDerivativeIntent,

} from "./smart-upload-intent";

import { generateSmartUploadCaptions } from "./smart-upload-caption";
import { defaultBookContextCta } from "./smart-upload-caption-cta";

import { setSmartUploadCaptionBufferReaderForTests } from "./smart-upload-caption-image";

import type { SmartUploadCaptionModelPayload } from "./smart-upload-caption-types";

import { SmartUploadCaptionGroundingError } from "./smart-upload-caption-errors";

import { SmartUploadCaptionProviderError } from "./smart-upload-caption-errors";

import type { MarketingCampaign } from "./types";



const ORIGINAL_PATH = `marketing/public/${"f".repeat(32)}.png`;

const DERIVATIVE_PATH = `marketing/public/${"d".repeat(32)}.png`;

const TINY_PNG = Buffer.from(

  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",

  "base64",

);



const originalSecret = process.env.ADMIN_SESSION_SECRET;



function testProvider(payload: SmartUploadCaptionModelPayload): AIProvider {

  return {

    id: "test",

    async generateText() {

      return "";

    },

    async generateStructuredOutput({ fallback }) {

      return fallback;

    },

    async generateMultimodalStructuredOutput<T>() {

      return payload as T;

    },

    async classify() {

      return "";

    },

    async analyze() {

      return "";

    },

  };

}



function payloadWithClaims(
  partial: Partial<SmartUploadCaptionModelPayload> & { mode: SmartUploadCaptionModelPayload["mode"] },
): SmartUploadCaptionModelPayload {
  return {
    usedMedicalClaims: [],
    instagramHashtags: [],
    ...partial,
  } as SmartUploadCaptionModelPayload;
}



beforeEach(() => {

  process.env.ADMIN_SESSION_SECRET = "caption-gen-test-secret";

  setSmartUploadCaptionBufferReaderForTests(async () => TINY_PNG);

});



afterEach(() => {

  setSmartUploadCaptionBufferReaderForTests(null);

  if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;

  else process.env.ADMIN_SESSION_SECRET = originalSecret;

});



function stagedRef(uploadIntent: string, pathname = ORIGINAL_PATH) {

  return { uploadIntent, pathname };

}



test("generateSmartUploadCaptions shared mode with mock provider", async () => {

  const store = new MemoryMarketingStore();

  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;

  const provider = testProvider(

    payloadWithClaims({

      mode: "shared",

      sharedBody: "Hello families",

      sharedCta: "Model CTA",

      instagramHashtags: ["#TwilightFeather", "#twilightfeather", "#Parenting"],

    }),

  );



  const result = await generateSmartUploadCaptions(store, {

    actorUsername: "owner",

    mode: "shared",

    instructions: null,

    explicitCta: null,

    bookId: "book-one",

    campaignId: null,

    original: stagedRef(uploadIntent),

    acceptedDerivative: null,

    provider,

  });



  assert.equal(result.mode, "shared");

  assert.equal(result.shared?.body, "Hello families");

  assert.equal(result.shared?.instagramHashtags.length, 2);

  assert.equal(result.shared?.cta, defaultBookContextCta("book-one"));

  assert.equal(result.imagePathname, ORIGINAL_PATH);

  assert.equal(result.provider, "test");

});



test("generateSmartUploadCaptions per_platform mode", async () => {

  const store = new MemoryMarketingStore();

  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;

  const provider = testProvider(

    payloadWithClaims({

      mode: "per_platform",

      instagramBody: "IG copy",

      facebookBody: "FB copy",

      instagramHashtags: ["Parenting"],

      instagramCta: null,

      facebookCta: null,

    }),

  );



  const result = await generateSmartUploadCaptions(store, {

    actorUsername: "owner",

    mode: "per_platform",

    instructions: "Be cheerful",

    explicitCta: null,

    bookId: null,

    campaignId: null,

    original: stagedRef(uploadIntent),

    acceptedDerivative: null,

    provider,

  });



  assert.equal(result.instagram?.body, "IG copy");

  assert.equal(result.facebook?.body, "FB copy");

  assert.deepEqual(result.instagram?.hashtags, ["#Parenting"]);

});



test("campaign CTA with medical statistic rejected for grounding", async () => {
  const store = new MemoryMarketingStore();
  const campaign: MarketingCampaign = {
    id: "camp-cta-scan",
    name: "Camp",
    objective: "Promote",
    status: "active",
    primaryAudience: "parents",
    secondaryAudience: null,
    coreMessage: "Brand message",
    contentThemes: [],
    channelDistribution: {},
    recommendedFrequency: {},
    cta: "Studies show 50% of children improve.",
    requiredAssets: [],
    measurementGoals: [],
    bookIds: [],
    startOn: null,
    endOn: null,
    createdBy: null,
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.createCampaign(campaign);

  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;
  const provider = testProvider(
    payloadWithClaims({
      mode: "shared",
      sharedBody: "Warm family reading moment.",
      instagramHashtags: [],
    }),
  );

  await assert.rejects(
    () =>
      generateSmartUploadCaptions(store, {
        actorUsername: "owner",
        mode: "shared",
        instructions: null,
        explicitCta: null,
        bookId: null,
        campaignId: campaign.id,
        original: stagedRef(uploadIntent),
        acceptedDerivative: null,
        provider,
      }),
    SmartUploadCaptionGroundingError,
  );
});

test("scanMarketingText still warns on safe resolved CTA with discount mix", async () => {
  const store = new MemoryMarketingStore();
  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;
  const provider = testProvider(
    payloadWithClaims({
      mode: "shared",
      sharedBody: "Warm family reading moment.",
      instagramHashtags: [],
    }),
  );

  const result = await generateSmartUploadCaptions(store, {
    actorUsername: "owner",
    mode: "shared",
    instructions: null,
    explicitCta: "Get 10% off on Amazon today.",
    bookId: null,
    campaignId: null,
    original: stagedRef(uploadIntent),
    acceptedDerivative: null,
    provider,
  });

  assert.ok(result.warnings.length > 0);
});

test("campaign CTA applied in generation result", async () => {

  const store = new MemoryMarketingStore();

  const campaign: MarketingCampaign = {

    id: "camp-caption",

    name: "Camp",

    objective: "Promote",

    status: "active",

    primaryAudience: "parents",

    secondaryAudience: null,

    coreMessage: "Approved core",

    contentThemes: [],

    channelDistribution: {},

    recommendedFrequency: {},

    cta: "Use campaign CTA",

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

  await store.createCampaign(campaign);



  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;

  const provider = testProvider(

    payloadWithClaims({

      mode: "shared",

      sharedBody: "Body",

      sharedCta: "Model should lose",

      instagramHashtags: [],

    }),

  );



  const result = await generateSmartUploadCaptions(store, {

    actorUsername: "owner",

    mode: "shared",

    instructions: null,

    explicitCta: null,

    bookId: null,

    campaignId: campaign.id,

    original: stagedRef(uploadIntent),

    acceptedDerivative: null,

    provider,

  });



  assert.equal(result.shared?.cta, "Use campaign CTA");

});



test("resolved explicit CTA with medical statistic rejected for grounding", async () => {
  const store = new MemoryMarketingStore();
  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;
  const provider = testProvider(
    payloadWithClaims({
      mode: "shared",
      sharedBody: "Safe brand copy for families.",
      instagramHashtags: [],
    }),
  );

  await assert.rejects(
    () =>
      generateSmartUploadCaptions(store, {
        actorUsername: "owner",
        mode: "shared",
        instructions: null,
        explicitCta: "Studies show 50% of children improve.",
        bookId: null,
        campaignId: null,
        original: stagedRef(uploadIntent),
        acceptedDerivative: null,
        provider,
      }),
    SmartUploadCaptionGroundingError,
  );
});



test("generated copy with invented statistic rejected for grounding", async () => {

  const store = new MemoryMarketingStore();

  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;

  const provider = testProvider(

    payloadWithClaims({

      mode: "shared",

      sharedBody: "Studies show 50% of children improve.",

      instagramHashtags: [],

    }),

  );



  await assert.rejects(

    () =>

      generateSmartUploadCaptions(store, {

        actorUsername: "owner",

        mode: "shared",

        instructions: null,

        explicitCta: null,

        bookId: null,

        campaignId: null,

        original: stagedRef(uploadIntent),

        acceptedDerivative: null,

        provider,

      }),

    SmartUploadCaptionGroundingError,

  );

});



test("unsupported medical claim rejected at generation", async () => {

  const store = new MemoryMarketingStore();

  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;

  const provider = testProvider(

    payloadWithClaims({

      mode: "shared",

      sharedBody: "Sickle cell disease can cause organ damage over time.",

      instagramHashtags: [],

      usedMedicalClaims: [],

    }),

  );



  await assert.rejects(

    () =>

      generateSmartUploadCaptions(store, {

        actorUsername: "owner",

        mode: "shared",

        instructions: null,

        explicitCta: null,

        bookId: "book-one",

        campaignId: null,

        original: stagedRef(uploadIntent),

        acceptedDerivative: null,

        provider,

      }),

    SmartUploadCaptionGroundingError,

  );

});



test("campaign coreMessage cannot authorize unapproved medical facts", async () => {

  const store = new MemoryMarketingStore();

  const campaign: MarketingCampaign = {

    id: "camp-med",

    name: "Camp",

    objective: "Promote",

    status: "active",

    primaryAudience: "parents",

    secondaryAudience: null,

    coreMessage: "Sickle cell disease can cause organ damage over time.",

    contentThemes: [],

    channelDistribution: {},

    recommendedFrequency: {},

    cta: null,

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

  await store.createCampaign(campaign);



  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;

  const provider = testProvider(

    payloadWithClaims({

      mode: "shared",

      sharedBody: "Sickle cell disease can cause organ damage over time.",

      instagramHashtags: [],

    }),

  );



  await assert.rejects(

    () =>

      generateSmartUploadCaptions(store, {

        actorUsername: "owner",

        mode: "shared",

        instructions: null,

        explicitCta: null,

        bookId: "book-one",

        campaignId: campaign.id,

        original: stagedRef(uploadIntent),

        acceptedDerivative: null,

        provider,

      }),

    SmartUploadCaptionGroundingError,

  );

});



test("generation does not create marketing content rows", async () => {

  const store = new MemoryMarketingStore();

  const before = (await store.listContent()).length;

  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;

  const provider = testProvider(

    payloadWithClaims({

      mode: "shared",

      sharedBody: "Body",

      instagramHashtags: [],

    }),

  );



  await generateSmartUploadCaptions(store, {

    actorUsername: "owner",

    mode: "shared",

    instructions: null,

    explicitCta: null,

    bookId: null,

    campaignId: null,

    original: stagedRef(uploadIntent),

    acceptedDerivative: null,

    provider,

  });



  const after = (await store.listContent()).length;

  assert.equal(before, after);

});



test("unknown book rejected", async () => {

  const store = new MemoryMarketingStore();

  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;

  await assert.rejects(

    () =>

      generateSmartUploadCaptions(store, {

        actorUsername: "owner",

        mode: "shared",

        instructions: null,

        explicitCta: null,

        bookId: "not-a-book",

        campaignId: null,

        original: stagedRef(uploadIntent),

        acceptedDerivative: null,

        provider: testProvider(payloadWithClaims({ mode: "shared", sharedBody: "x", instagramHashtags: [] })),

      }),

    /Unknown book/i,

  );

});



test("invalid model payload rejected as provider error", async () => {

  const store = new MemoryMarketingStore();

  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;

  const provider = testProvider({

    mode: "per_platform",

    usedMedicalClaims: [],

    instagramBody: "only ig",

  } as SmartUploadCaptionModelPayload);



  await assert.rejects(

    () =>

      generateSmartUploadCaptions(store, {

        actorUsername: "owner",

        mode: "per_platform",

        instructions: null,

        explicitCta: null,

        bookId: null,

        campaignId: null,

        original: stagedRef(uploadIntent),

        acceptedDerivative: null,

        provider,

      }),

    SmartUploadCaptionProviderError,

  );

});



test("derivative image used when linkage verified", async () => {

  const store = new MemoryMarketingStore();

  const originalIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;

  const derivativeIntent = issueSmartUploadPreviewDerivativeIntent({

    username: "owner",

    pathname: DERIVATIVE_PATH,

    originalPathname: ORIGINAL_PATH,

    finalizeKey: "fk-cap",

    strategy: "pad",

    targetRatio: "4:5",

  }).uploadIntent;



  const provider = testProvider(

    payloadWithClaims({

      mode: "shared",

      sharedBody: "Derivative caption",

      instagramHashtags: [],

    }),

  );



  const result = await generateSmartUploadCaptions(store, {

    actorUsername: "owner",

    mode: "shared",

    instructions: null,

    explicitCta: null,

    bookId: null,

    campaignId: null,

    original: stagedRef(originalIntent),

    acceptedDerivative: stagedRef(derivativeIntent, DERIVATIVE_PATH),

    finalizeKey: "fk-cap",

    strategy: "pad",

    targetRatio: "4:5",

    provider,

  });



  assert.equal(result.imagePathname, DERIVATIVE_PATH);

});

test("explicit CTA medical fact rejected at generation", async () => {
  const store = new MemoryMarketingStore();
  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;
  const provider = testProvider(
    payloadWithClaims({
      mode: "shared",
      sharedBody: "Warm family reading moment.",
      instagramHashtags: [],
    }),
  );

  await assert.rejects(
    () =>
      generateSmartUploadCaptions(store, {
        actorUsername: "owner",
        mode: "shared",
        instructions: null,
        explicitCta: "Use this treatment to prevent asthma attacks.",
        bookId: "book-three",
        campaignId: null,
        original: stagedRef(uploadIntent),
        acceptedDerivative: null,
        provider,
      }),
    SmartUploadCaptionGroundingError,
  );
});

test("unsafe clinical hashtag rejected at generation", async () => {
  const store = new MemoryMarketingStore();
  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;
  const provider = testProvider(
    payloadWithClaims({
      mode: "shared",
      sharedBody: "Warm family reading moment.",
      instagramHashtags: ["AsthmaCure"],
    }),
  );

  await assert.rejects(
    () =>
      generateSmartUploadCaptions(store, {
        actorUsername: "owner",
        mode: "shared",
        instructions: null,
        explicitCta: null,
        bookId: null,
        campaignId: null,
        original: stagedRef(uploadIntent),
        acceptedDerivative: null,
        provider,
      }),
    SmartUploadCaptionGroundingError,
  );
});
