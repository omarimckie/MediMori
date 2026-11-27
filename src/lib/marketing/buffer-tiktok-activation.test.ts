import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { BufferTikTokPublisher } from "./buffer-tiktok-publisher";
import {
  evaluateBufferTikTokLiveSubmissionGate,
  parseBufferTikTokActivationConfig,
  resetBufferTikTokControlledSubmitLocksForTests,
  withBufferTikTokControlledSubmitLock,
} from "./buffer/buffer-tiktok-activation";
import type { MarketingContent, MarketingPublication } from "./types";

const ORIGINAL = { ...process.env };

function liveEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    MARKETING_MOCK_MODE: "false",
    MARKETING_BUFFER_TIKTOK_ENABLED: "true",
    MARKETING_BUFFER_TIKTOK_LIVE: "true",
    BUFFER_TIKTOK_CHANNEL_ID: "ch",
    BUFFER_ACCESS_TOKEN: "test-token",
    ...overrides,
  };
}

afterEach(() => {
  resetBufferTikTokControlledSubmitLocksForTests();
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
});

test("missing activation mode is disabled and blocks live submission", () => {
  const config = parseBufferTikTokActivationConfig(liveEnv({ MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE: "" }));
  assert.equal(config.mode, "disabled");
  assert.equal(config.configValid, true);
  const gate = evaluateBufferTikTokLiveSubmissionGate(
    "pub-1",
    liveEnv({ MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE: "" }),
  );
  assert.equal(gate.allow, false);
  if (!gate.allow) assert.equal(gate.errorCode, "buffer_tiktok_activation_disabled");
});

test("automated mode requires explicit configuration", () => {
  const config = parseBufferTikTokActivationConfig(
    liveEnv({ MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE: "automated" }),
  );
  assert.equal(config.mode, "automated");
  assert.equal(config.configValid, true);
  const gate = evaluateBufferTikTokLiveSubmissionGate(
    crypto.randomUUID(),
    liveEnv({ MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE: "automated" }),
  );
  assert.equal(gate.allow, true);
});

test("controlled mode rejects empty and multi-id allowlists", () => {
  const empty = parseBufferTikTokActivationConfig(
    liveEnv({ MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE: "controlled" }),
  );
  assert.equal(empty.configValid, false);
  const multi = parseBufferTikTokActivationConfig(
    liveEnv({
      MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE: "controlled",
      MARKETING_BUFFER_TIKTOK_CONTROLLED_PUBLICATION_ID: `${crypto.randomUUID()},${crypto.randomUUID()}`,
    }),
  );
  assert.equal(multi.configValid, false);
});

test("controlled mode allows only one publication id", () => {
  const pubId = crypto.randomUUID();
  const env = liveEnv({
    MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE: "controlled",
    MARKETING_BUFFER_TIKTOK_CONTROLLED_PUBLICATION_ID: pubId,
  });
  assert.equal(evaluateBufferTikTokLiveSubmissionGate(pubId, env).allow, true);
  const blocked = evaluateBufferTikTokLiveSubmissionGate(crypto.randomUUID(), env);
  assert.equal(blocked.allow, false);
  if (!blocked.allow) assert.equal(blocked.errorCode, "buffer_tiktok_activation_not_allowlisted");
});

test("concurrent controlled submit lock serializes duplicate Buffer calls", async () => {
  const pubId = crypto.randomUUID();
  const env = liveEnv({
    MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE: "controlled",
    MARKETING_BUFFER_TIKTOK_CONTROLLED_PUBLICATION_ID: pubId,
  });
  let concurrent = 0;
  let maxConcurrent = 0;
  const task = () =>
    withBufferTikTokControlledSubmitLock(pubId, env, async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 20));
      concurrent -= 1;
    });
  await Promise.all([task(), task(), task()]);
  assert.equal(maxConcurrent, 1);
});

test("publisher blocks live submission when activation config is invalid", async () => {
  Object.assign(
    process.env,
    liveEnv({
      MARKETING_BUFFER_TIKTOK_ACTIVATION_MODE: "controlled",
      MARKETING_BUFFER_TIKTOK_CONTROLLED_PUBLICATION_ID: "not-a-uuid",
    }),
  );
  const publisher = new BufferTikTokPublisher();
  const { content, publication } = samplePublishRequest();
  const result = await publisher.publish({ content, publication, imageUrl: "https://cdn.example/a.jpg" });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "buffer_tiktok_activation_config_invalid");
});

function samplePublishRequest(): {
  content: MarketingContent;
  publication: MarketingPublication;
} {
  const content: MarketingContent = {
    id: "c",
    campaignId: null,
    weeklyPlanId: null,
    platform: "tiktok",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "scheduled",
    title: "t",
    body: "b",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: null,
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const publication: MarketingPublication = {
    id: "p",
    contentId: "c",
    campaignId: null,
    platform: "tiktok",
    provider: "buffer_tiktok",
    status: "processing",
    idempotencyKey: "pub:c:tiktok",
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: null,
    publishedAt: null,
    claimToken: "claim",
    processingStartedAt: new Date().toISOString(),
    providerCreationId: null,
    ambiguityState: "none",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return { content, publication };
}