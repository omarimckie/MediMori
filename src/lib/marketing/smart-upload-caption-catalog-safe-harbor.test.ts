import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { AIProvider } from "./ai";
import { defaultBookContextCta } from "./smart-upload-caption-cta";
import { SmartUploadCaptionGroundingError } from "./smart-upload-caption-errors";
import {
  assertCaptionFieldMedicalPolicy,
  validateDeclaredUsedMedicalClaims,
} from "./smart-upload-caption-medical-grounding";
import { isWhollySafeCatalogProductReference } from "./smart-upload-caption-catalog-safe-harbor";
import { assertClinicalHashtagsSafe } from "./smart-upload-caption-hashtag-safety";
import { generateSmartUploadCaptions } from "./smart-upload-caption";
import { MemoryMarketingStore } from "./memory-store";
import { issueSmartUploadIntent } from "./smart-upload-intent";
import { setSmartUploadCaptionBufferReaderForTests } from "./smart-upload-caption-image";
import type { SmartUploadCaptionModelPayload } from "./smart-upload-caption-types";
import { APPROVED_CLAIMS } from "./brain";

const SICKLE_STORY = APPROVED_CLAIMS.find((c) => c.id === "sickle-cell-story")!.body;
const ORIGINAL_PATH = `marketing/public/${"f".repeat(32)}.png`;
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function R(text: string, bookId: string | null) {
  try {
    assertCaptionFieldMedicalPolicy(text, [], bookId);
    return "PASS";
  } catch (e) {
    return e instanceof SmartUploadCaptionGroundingError ? "REJECT" : "ERR";
  }
}

test("PASS product and title references without declarations", () => {
  const lines = [
    "Read Children Diseases: Sickle Cell.",
    "Explore our children's book about sickle cell disease.",
    "Meet Amara in our Sickle Cell story.",
    "Read the Sickle Cell story.",
    "Discover our asthma book for families.",
    "Learn more about AJ Can Breathe Easy, our children's asthma story.",
    "Find our Sickle Cell and Asthma books at twilight-feather.com.",
    "Learn more at twilight-feather.com.",
    "Shop the Children Diseases series.",
  ];
  for (const line of lines) {
    assert.equal(R(line, "book-one"), "PASS", line);
  }
  for (const line of lines) {
    if (line === "Learn more at twilight-feather.com.") continue;
    assert.ok(isWhollySafeCatalogProductReference(line, "book-one"), line);
  }
});

test("defaultBookContextCta for book-one and book-three pass medical policy", () => {
  for (const bookId of ["book-one", "book-three"] as const) {
    const cta = defaultBookContextCta(bookId);
    assert.ok(cta);
    assert.equal(R(cta!, bookId), "PASS");
  }
});

test("REJECT product reference mixed with clinical assertions", () => {
  const rejects = [
    "Read our Sickle Cell story because sickle cell causes organ damage.",
    "Explore our asthma book to learn why inhalers prevent attacks.",
    "Meet Amara in our Sickle Cell story, where you'll learn that the disease is inherited from both parents.",
    "Discover our asthma book because asthma can be cured.",
    "Read Children Diseases: Sickle Cell — 90% of children experience fatigue.",
    "Our asthma book explains how inhalers prevent asthma attacks.",
    "Read our Sickle Cell story because the disease is inherited from both parents.",
    "Meet AJ, who shows that inhalers prevent asthma attacks.",
    "A children's book about how asthma attacks can be prevented.",
    "Sickle cell disease causes organ damage.",
    "Asthma can make it hard to breathe.",
    "Sickle cell can cause painful crises.",
    "Asthma attacks can be prevented with treatment.",
  ];
  for (const line of rejects) {
    assert.equal(R(line, "book-one"), "REJECT", line);
  }
});

test("neutral condition hashtags still pass clinical hashtag gate", () => {
  assertClinicalHashtagsSafe(["SickleCell", "Asthma", "KidsHealth"]);
  assert.throws(() => assertClinicalHashtagsSafe(["AsthmaCure"]), SmartUploadCaptionGroundingError);
});

const originalSecret = process.env.ADMIN_SESSION_SECRET;

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = "catalog-safe-harbor-test";
  setSmartUploadCaptionBufferReaderForTests(async () => TINY_PNG);
});

afterEach(() => {
  setSmartUploadCaptionBufferReaderForTests(null);
  if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = originalSecret;
});

function testProvider(
  payload: Omit<SmartUploadCaptionModelPayload, "pinterestTitle" | "pinterestDescription"> &
    Partial<Pick<SmartUploadCaptionModelPayload, "pinterestTitle" | "pinterestDescription">>,
): AIProvider {
  const normalized: SmartUploadCaptionModelPayload = {
    ...payload,
    pinterestTitle: payload.pinterestTitle ?? "Story pin",
    pinterestDescription: payload.pinterestDescription ?? "Discover our children's book.",
  };
  return {
    id: "test",
    async generateText() {
      return "";
    },
    async generateStructuredOutput({ fallback }) {
      return fallback;
    },
    async generateMultimodalStructuredOutput<T>() {
      return normalized as T;
    },
    async classify() {
      return "";
    },
    async analyze() {
      return "";
    },
  };
}

test("orchestration accepts server default book CTA for book-one", async () => {
  const store = new MemoryMarketingStore();
  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;
  const provider = testProvider({
    mode: "shared",
    usedMedicalClaims: [],
    sharedBody: "Warm family reading moment.",
    sharedCta: null,
    instagramHashtags: [],
  });

  const result = await generateSmartUploadCaptions(store, {
    actorUsername: "owner",
    mode: "shared",
    instructions: null,
    explicitCta: null,
    bookId: "book-one",
    campaignId: null,
    original: { uploadIntent, pathname: ORIGINAL_PATH },
    acceptedDerivative: null,
    provider,
  });

  assert.equal(result.shared?.cta, defaultBookContextCta("book-one"));
});

test("orchestration accepts server default book CTA for book-three", async () => {
  const store = new MemoryMarketingStore();
  const uploadIntent = issueSmartUploadIntent({ username: "owner", pathname: ORIGINAL_PATH }).uploadIntent;
  const provider = testProvider({
    mode: "shared",
    usedMedicalClaims: [],
    sharedBody: "A gentle invitation to read together.",
    instagramHashtags: [],
  });

  const result = await generateSmartUploadCaptions(store, {
    actorUsername: "owner",
    mode: "shared",
    instructions: null,
    explicitCta: null,
    bookId: "book-three",
    campaignId: null,
    original: { uploadIntent, pathname: ORIGINAL_PATH },
    acceptedDerivative: null,
    provider,
  });

  assert.equal(result.shared?.cta, defaultBookContextCta("book-three"));
});

test("verbatim approved claim still required for clinical copy", () => {
  const declared = validateDeclaredUsedMedicalClaims(
    [{ claimId: "sickle-cell-story", text: SICKLE_STORY }],
    "book-one",
  );
  assertCaptionFieldMedicalPolicy(SICKLE_STORY, declared, "book-one");
  assert.equal(R("Sickle cell disease causes organ damage.", "book-one"), "REJECT");
});
