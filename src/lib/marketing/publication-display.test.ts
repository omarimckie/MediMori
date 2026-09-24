import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { isMockMode } from "./config";
import { isPinterestLiveConfigured } from "./pinterest";
import { publishDueButtonLabel } from "./publication-display";

const PINTEREST_ENV = {
  PINTEREST_CLIENT_ID: "client",
  PINTEREST_CLIENT_SECRET: "secret",
  PINTEREST_REFRESH_TOKEN: "pinr_test_token",
  PINTEREST_BOARD_ID: "1113655882796897267",
};

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

test("publishDueButtonLabel mock mode => mock label", () => {
  assert.equal(
    publishDueButtonLabel(true, true),
    "Publish due items (mock — no live networks)",
  );
});

test("publishDueButtonLabel live + Pinterest configured => live Meta + Pinterest label", () => {
  assert.equal(
    publishDueButtonLabel(false, true),
    "Publish due items (live Meta + Pinterest where configured)",
  );
});

test("publishDueButtonLabel live + Pinterest not configured => live Meta-only label", () => {
  assert.equal(
    publishDueButtonLabel(false, false),
    "Publish due items (live Meta where configured)",
  );
});

test("marketing settings response shape includes pinterestLiveConfigured boolean only", () => {
  process.env.MARKETING_MOCK_MODE = "false";
  Object.assign(process.env, PINTEREST_ENV);

  const body = {
    quotas: {},
    plans: [],
    publications: [],
    mockMode: isMockMode(),
    pinterestLiveConfigured: isPinterestLiveConfigured(),
  };

  assert.equal(typeof body.pinterestLiveConfigured, "boolean");
  assert.equal(body.pinterestLiveConfigured, true);

  const json = JSON.stringify(body);
  assert.match(json, /"pinterestLiveConfigured":true/);
  assert.doesNotMatch(json, /PINTEREST_CLIENT_ID/);
  assert.doesNotMatch(json, /PINTEREST_CLIENT_SECRET/);
  assert.doesNotMatch(json, /PINTEREST_REFRESH_TOKEN/);
  assert.doesNotMatch(json, /PINTEREST_BOARD_ID/);
  assert.doesNotMatch(json, /pinr_/);
});
