import assert from "node:assert/strict";
import { test } from "node:test";
import { BufferGraphqlError } from "./buffer-graphql-client";
import {
  bufferListOrganizationChannels,
  isTikTokChannelUsable,
  listTikTokChannels,
  pickTikTokChannel,
} from "./buffer-channels";

const ORG_ID = "69d9e21d4cc2f109ac3f69de";
const VERIFIED_TIKTOK_ID = "6ae9565de29c69a17143fd5d";

function graphqlResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("bufferListOrganizationChannels parses channels(input) payload", async () => {
  let capturedBody: { query?: string; variables?: Record<string, unknown> } | undefined;
  const channels = await bufferListOrganizationChannels(ORG_ID, {
    accessToken: "test-token",
    fetchImpl: async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return graphqlResponse({
        data: {
          channels: [
            {
              id: VERIFIED_TIKTOK_ID,
              name: "twilight.feather",
              service: "tiktok",
              isDisconnected: false,
              isLocked: false,
            },
            { id: "ig-1", name: "IG", service: "instagram", isDisconnected: false, isLocked: false },
          ],
        },
      });
    },
  });

  assert.ok(capturedBody?.query?.includes("OrganizationId"));
  assert.ok(capturedBody?.query?.includes("channels(input:"));
  assert.deepEqual(capturedBody?.variables, { organizationId: ORG_ID });
  assert.equal(channels.length, 2);
  assert.equal(channels[0]?.id, VERIFIED_TIKTOK_ID);
});

test("bufferListOrganizationChannels surfaces GraphQL permission errors", async () => {
  await assert.rejects(
    () =>
      bufferListOrganizationChannels(ORG_ID, {
        accessToken: "test-token",
        fetchImpl: async () =>
          graphqlResponse({
            errors: [{ message: "Not authorized to access this organization" }],
          }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof BufferGraphqlError);
      assert.match(error.message, /Not authorized/i);
      return true;
    },
  );
});

test("pickTikTokChannel prefers preferred id when usable", () => {
  const picked = pickTikTokChannel(
    [
      { id: "other-tt", name: "alt", service: "tiktok", isDisconnected: false, isLocked: false },
      { id: VERIFIED_TIKTOK_ID, name: "twilight.feather", service: "tiktok", isDisconnected: false, isLocked: false },
    ],
    VERIFIED_TIKTOK_ID,
  );
  assert.equal(picked?.id, VERIFIED_TIKTOK_ID);
});

test("pickTikTokChannel skips multiple TikTok rows that are disconnected or locked", () => {
  const channels = [
    { id: "a", name: "locked", service: "tiktok", isDisconnected: false, isLocked: true },
    { id: "b", name: "off", service: "tiktok", isDisconnected: true, isLocked: false },
    { id: VERIFIED_TIKTOK_ID, name: "twilight.feather", service: "tiktok", isDisconnected: false, isLocked: false },
  ];
  assert.equal(listTikTokChannels(channels).length, 3);
  assert.equal(pickTikTokChannel(channels)?.id, VERIFIED_TIKTOK_ID);
  assert.equal(isTikTokChannelUsable(channels[0]!), false);
  assert.equal(isTikTokChannelUsable(channels[2]!), true);
});

test("pickTikTokChannel returns null when every TikTok channel is unusable", () => {
  assert.equal(
    pickTikTokChannel([{ id: "x", name: "x", service: "tiktok", isDisconnected: true, isLocked: false }]),
    null,
  );
});