import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ProcessVerifiedQstashDeliveryResult } from "./qstash-primary/process-verified-qstash-delivery";
import {
  handleMarketingPublishCron,
  MAX_QSTASH_SIGNED_BODY_BYTES,
  observeVerifiedQstashPrimaryHeartbeat,
  readBoundedUtf8RequestBody,
} from "./marketing-publish-cron";
import type { ReliabilitySweepResult } from "./sweep";

const sweepResult = (): ReliabilitySweepResult => ({
  overdueDetected: 0,
  stuckProcessingDetected: 0,
  notificationsCreated: 0,
  notificationsSkippedDuplicate: 0,
  dedupesCleaned: 0,
  reconcile: {
    examined: 0,
    autoResolved: 0,
    overdueAutoResolved: 0,
    stuckAutoResolved: 0,
    skippedUnsafe: 0,
    skippedMissingPublication: 0,
    skippedConflict: 0,
    skippedPolicy: 0,
    failed: 0,
  },
  partialPublicationFailureObserved: 0,
});

function baseDeps(overrides: Partial<Parameters<typeof handleMarketingPublishCron>[1]> = {}) {
  return {
    authorize: async () => ({ ok: true, reason: "cron_secret" }),
    getStore: () => ({}) as never,
    publishDue: async () => [],
    recordHeartbeat: async () => {},
    runReliabilityAfterMarketingPublish: async () => null,
    ...overrides,
  };
}

function requestWithOptionalSignature(input: {
  body?: string | Uint8Array | ReadableStream<Uint8Array> | null;
  signature?: string;
  messageId?: string;
}) {
  const headers = new Headers();
  if (input.signature) {
    headers.set("upstash-signature", input.signature);
  }
  if (input.messageId) {
    headers.set("upstash-message-id", input.messageId);
  }
  const requestBody: BodyInit | null =
    input.body instanceof Uint8Array
      ? new Uint8Array(input.body)
      : (input.body ?? null);
  return new Request("https://twilight-feather.com/api/cron/marketing-publish", {
    method: "POST",
    headers,
    body: requestBody,
  });
}

describe("marketing-publish qstash primary integration", () => {
  it("T16: production handler imports real H2 orchestration entry point", () => {
    const source = readFileSync(
      "src/lib/marketing/reliability/marketing-publish-cron.ts",
      "utf8",
    );
    assert.match(source, /processVerifiedQstashDelivery/);
    assert.doesNotMatch(source, /createProcessVerifiedQstashDeliveryForTests/);
    assert.doesNotMatch(source, /recordVerifiedPrimaryHeartbeatInLock/);
  });

  it("T20: route GET delegates to POST handler wiring", () => {
    const source = readFileSync("src/app/api/cron/marketing-publish/route.ts", "utf8");
    assert.match(source, /export async function GET/);
    assert.match(source, /return POST\(request\)/);
    assert.match(source, /handleMarketingPublishCron/);
  });

  describe("handleMarketingPublishCron observational heartbeat", () => {
    it("T11: unauthorized request skips H2 and publishDue", async () => {
      let observeCalls = 0;
      let publishCalls = 0;
      const outcome = await handleMarketingPublishCron(
        requestWithOptionalSignature({ signature: "sig", body: "{}" }),
        baseDeps({
          authorize: async () => ({ ok: false, reason: "unauthorized" }),
          observeVerifiedQstashPrimaryHeartbeat: async () => {
            observeCalls += 1;
          },
          publishDue: async () => {
            publishCalls += 1;
            return [];
          },
        }),
      );
      assert.equal(outcome.ok, false);
      assert.equal(observeCalls, 0);
      assert.equal(publishCalls, 0);
    });

    it("T29: unauthorized signed request does not invoke observe hook", async () => {
      let observeCalls = 0;
      await handleMarketingPublishCron(
        requestWithOptionalSignature({ signature: "sig", body: "x" }),
        baseDeps({
          authorize: async () => ({ ok: false, reason: "unauthorized" }),
          observeVerifiedQstashPrimaryHeartbeat: async () => {
            observeCalls += 1;
          },
        }),
      );
      assert.equal(observeCalls, 0);
    });

    it("T09: admin session without signature skips H2", async () => {
      let processCalls = 0;
      await handleMarketingPublishCron(
        new Request("https://x", { method: "POST", body: '{"a":1}' }),
        baseDeps({
          authorize: async () => ({ ok: true, reason: "admin_session" }),
          observeVerifiedQstashPrimaryHeartbeat: async (req) => {
            await observeVerifiedQstashPrimaryHeartbeat(req, {
              processVerified: async () => {
                processCalls += 1;
                return { status: "internal_failure", code: "qstash_processing_internal_failure" };
              },
            });
          },
        }),
      );
      assert.equal(processCalls, 0);
    });

    it("T10: cron_secret without signature skips H2", async () => {
      let processCalls = 0;
      await handleMarketingPublishCron(
        new Request("https://x", { method: "POST", body: "{}" }),
        baseDeps({
          observeVerifiedQstashPrimaryHeartbeat: async (req) => {
            await observeVerifiedQstashPrimaryHeartbeat(req, {
              processVerified: async () => {
                processCalls += 1;
                return { status: "internal_failure", code: "qstash_processing_internal_failure" };
              },
            });
          },
        }),
      );
      assert.equal(processCalls, 0);
    });

    it("T01: signed request invokes H2 before publishDue", async () => {
      const order: string[] = [];
      const outcome = await handleMarketingPublishCron(
        requestWithOptionalSignature({ signature: "test-sig", body: '{"k":1}' }),
        baseDeps({
          observeVerifiedQstashPrimaryHeartbeat: async (req) => {
            order.push("observe");
            await observeVerifiedQstashPrimaryHeartbeat(req, {
              processVerified: async () => {
                order.push("h2");
                return {
                  status: "recorded",
                  outcome: "advanced",
                  jti: "jwt_test",
                  lastSeenAt: "2026-01-01T00:00:00.000Z",
                };
              },
            });
          },
          publishDue: async () => {
            order.push("publish");
            return [{ id: "pub-1" }];
          },
        }),
      );
      assert.deepEqual(order, ["observe", "h2", "publish"]);
      assert.equal(outcome.ok, true);
    });

    it("T17: H2 invoked at most once per request", async () => {
      let processCalls = 0;
      await handleMarketingPublishCron(
        requestWithOptionalSignature({ signature: "sig-once", body: "" }),
        baseDeps({
          observeVerifiedQstashPrimaryHeartbeat: async (req) => {
            await observeVerifiedQstashPrimaryHeartbeat(req, {
              processVerified: async () => {
                processCalls += 1;
                return {
                  status: "recorded",
                  outcome: "advanced",
                  jti: "j",
                  lastSeenAt: "2026-01-01T00:00:00.000Z",
                };
              },
            });
          },
        }),
      );
      assert.equal(processCalls, 1);
    });

    it("T14: signed raw body passed to H2 without JSON reserialization", async () => {
      const raw = '{"order":1,"note":"keep"}';
      let receivedBody: string | undefined;
      await handleMarketingPublishCron(
        requestWithOptionalSignature({ signature: "sig-body", body: raw }),
        baseDeps({
          observeVerifiedQstashPrimaryHeartbeat: async (req) => {
            await observeVerifiedQstashPrimaryHeartbeat(req, {
              processVerified: async (input) => {
                receivedBody = input.rawBody;
                return {
                  status: "verification_rejected",
                  code: "qstash_verification_rejected",
                };
              },
            });
          },
        }),
      );
      assert.equal(receivedBody, raw);
    });

    const rejectionCases: Array<{
      id: string;
      result: ProcessVerifiedQstashDeliveryResult;
    }> = [
      {
        id: "T03",
        result: { status: "verification_rejected", code: "qstash_verification_rejected" },
      },
      {
        id: "T04",
        result: { status: "verification_rejected", code: "qstash_signature_expired" },
      },
      {
        id: "T05",
        result: { status: "verification_rejected", code: "qstash_signature_not_yet_valid" },
      },
      {
        id: "T06",
        result: { status: "configuration_unavailable", code: "qstash_signing_config_missing" },
      },
      {
        id: "T07",
        result: {
          status: "persistence_failed",
          code: "qstash_heartbeat_persistence_failed",
          jti: "jti-x",
        },
      },
    ];

    for (const { id, result } of rejectionCases) {
      it(`${id}: heartbeat outcome does not block authorized publishing`, async () => {
        let publishCalls = 0;
        const outcome = await handleMarketingPublishCron(
          requestWithOptionalSignature({ signature: "sig", body: "{}" }),
          baseDeps({
            observeVerifiedQstashPrimaryHeartbeat: async (req) => {
              await observeVerifiedQstashPrimaryHeartbeat(req, {
                processVerified: async () => result,
              });
            },
            publishDue: async () => {
              publishCalls += 1;
              return [{ id: "p1" }];
            },
          }),
        );
        assert.equal(publishCalls, 1);
        assert.equal(outcome.ok, true);
        if (outcome.ok) {
          assert.equal(outcome.body.published, 1);
        }
      });
    }

    it("T02: duplicate jti result still publishes once", async () => {
      let publishCalls = 0;
      const outcome = await handleMarketingPublishCron(
        requestWithOptionalSignature({ signature: "sig", body: "{}" }),
        baseDeps({
          observeVerifiedQstashPrimaryHeartbeat: async (req) => {
            await observeVerifiedQstashPrimaryHeartbeat(req, {
              processVerified: async () => ({
                status: "recorded",
                outcome: "duplicate_jti",
                jti: "dup",
                lastSeenAt: "2026-01-01T00:00:00.000Z",
              }),
            });
          },
          publishDue: async () => {
            publishCalls += 1;
            return [];
          },
        }),
      );
      assert.equal(publishCalls, 1);
      assert.equal(outcome.ok, true);
    });

    it("T08: unexpected H2 exception is contained", async () => {
      let publishCalls = 0;
      const outcome = await handleMarketingPublishCron(
        requestWithOptionalSignature({ signature: "sig", body: "{}" }),
        baseDeps({
          observeVerifiedQstashPrimaryHeartbeat: async (req) => {
            await observeVerifiedQstashPrimaryHeartbeat(req, {
              processVerified: async () => {
                throw new Error("h2_exploded");
              },
            });
          },
          publishDue: async () => {
            publishCalls += 1;
            return [];
          },
        }),
      );
      assert.equal(publishCalls, 1);
      assert.equal(outcome.ok, true);
    });

    it("T18: verification rejection does not interrupt authorized publishing", async () => {
      const outcome = await handleMarketingPublishCron(
        requestWithOptionalSignature({ signature: "bad", body: "x" }),
        baseDeps({
          publishDue: async () => [{ id: "ok" }],
          observeVerifiedQstashPrimaryHeartbeat: async (req) => {
            await observeVerifiedQstashPrimaryHeartbeat(req, {
              processVerified: async () => ({
                status: "verification_rejected",
                code: "qstash_signature_invalid",
              }),
            });
          },
        }),
      );
      assert.equal(outcome.ok, true);
      if (outcome.ok) {
        assert.equal(outcome.body.published, 1);
      }
    });

    it("T19: heartbeat failure does not duplicate publishDue", async () => {
      let publishCalls = 0;
      await handleMarketingPublishCron(
        requestWithOptionalSignature({ signature: "sig", body: "{}" }),
        baseDeps({
          observeVerifiedQstashPrimaryHeartbeat: async (req) => {
            await observeVerifiedQstashPrimaryHeartbeat(req, {
              processVerified: async () => ({
                status: "persistence_failed",
                code: "qstash_heartbeat_persistence_failed",
                jti: "j",
              }),
            });
          },
          publishDue: async () => {
            publishCalls += 1;
            return [];
          },
        }),
      );
      assert.equal(publishCalls, 1);
    });

    it("T12: publishDue failure still propagates", async () => {
      await assert.rejects(
        handleMarketingPublishCron(
          requestWithOptionalSignature({ signature: "sig", body: "{}" }),
          baseDeps({
            publishDue: async () => {
              throw new Error("publish_failed");
            },
          }),
        ),
        /publish_failed/,
      );
    });

    it("T13: success response shape unchanged", async () => {
      const outcome = await handleMarketingPublishCron(
        new Request("https://x"),
        baseDeps({
          publishDue: async () => [{ id: "a" }],
          runReliabilityAfterMarketingPublish: async () => sweepResult(),
        }),
      );
      assert.equal(outcome.ok, true);
      if (outcome.ok) {
        assert.equal(outcome.status, 200);
        assert.equal(outcome.body.published, 1);
        assert.deepEqual(outcome.body.results, [{ id: "a" }]);
        assert.ok(outcome.body.reliability);
        assert.equal("heartbeat" in outcome.body, false);
      }
    });

    it("T15: spoofed scheduler headers without signature do not invoke H2", async () => {
      let processCalls = 0;
      const req = new Request("https://x", {
        method: "POST",
        headers: {
          "x-vercel-cron-schedule": "0 16 * * *",
          "user-agent": "vercel-cron/1.0",
        },
        body: "{}",
      });
      await handleMarketingPublishCron(
        req,
        baseDeps({
          observeVerifiedQstashPrimaryHeartbeat: async (r) => {
            await observeVerifiedQstashPrimaryHeartbeat(r, {
              processVerified: async () => {
                processCalls += 1;
                return { status: "internal_failure", code: "qstash_processing_internal_failure" };
              },
            });
          },
        }),
      );
      assert.equal(processCalls, 0);
    });

    it("T28: oversized signed body still executes authorized publishing", async () => {
      let processCalls = 0;
      let publishCalls = 0;
      const big = "a".repeat(MAX_QSTASH_SIGNED_BODY_BYTES + 1);
      const outcome = await handleMarketingPublishCron(
        requestWithOptionalSignature({ signature: "sig", body: big }),
        baseDeps({
          observeVerifiedQstashPrimaryHeartbeat: async (req) => {
            await observeVerifiedQstashPrimaryHeartbeat(req, {
              processVerified: async () => {
                processCalls += 1;
                return { status: "internal_failure", code: "qstash_processing_internal_failure" };
              },
            });
          },
          publishDue: async () => {
            publishCalls += 1;
            return [];
          },
        }),
      );
      assert.equal(processCalls, 0);
      assert.equal(publishCalls, 1);
      assert.equal(outcome.ok, true);
    });
  });

  describe("readBoundedUtf8RequestBody", () => {
    it("T21: exactly 65536 bytes is accepted", async () => {
      const body = "a".repeat(MAX_QSTASH_SIGNED_BODY_BYTES);
      const req = new Request("https://x", { method: "POST", body });
      const read = await readBoundedUtf8RequestBody(req, MAX_QSTASH_SIGNED_BODY_BYTES);
      assert.equal(read.ok, true);
      if (read.ok) {
        assert.equal(new TextEncoder().encode(read.rawBody).byteLength, MAX_QSTASH_SIGNED_BODY_BYTES);
      }
    });

    it("T22: 65537 bytes is rejected", async () => {
      const body = "a".repeat(MAX_QSTASH_SIGNED_BODY_BYTES + 1);
      const req = new Request("https://x", { method: "POST", body });
      const read = await readBoundedUtf8RequestBody(req, MAX_QSTASH_SIGNED_BODY_BYTES);
      assert.equal(read.ok, false);
      if (!read.ok) {
        assert.equal(read.code, "qstash_signed_body_too_large");
      }
    });

    it("T23: multibyte UTF-8 is measured by bytes", async () => {
      const emoji = "😀";
      const bytes = new TextEncoder().encode(emoji);
      assert.equal(bytes.byteLength, 4);
      const req = new Request("https://x", { method: "POST", body: emoji });
      const read = await readBoundedUtf8RequestBody(req, MAX_QSTASH_SIGNED_BODY_BYTES);
      assert.equal(read.ok, true);
      if (read.ok) {
        assert.equal(read.rawBody, emoji);
      }
    });

    it("T24: missing Content-Length does not bypass the limit", async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_QSTASH_SIGNED_BODY_BYTES + 1).fill(97));
          controller.close();
        },
      });
      const req = new Request("https://x", {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit);
      const read = await readBoundedUtf8RequestBody(req, MAX_QSTASH_SIGNED_BODY_BYTES);
      assert.equal(read.ok, false);
      if (!read.ok) {
        assert.equal(read.code, "qstash_signed_body_too_large");
      }
    });

    it("T25: understated Content-Length does not bypass the limit", async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(10).fill(98));
          controller.enqueue(new Uint8Array(MAX_QSTASH_SIGNED_BODY_BYTES).fill(99));
          controller.close();
        },
      });
      const req = new Request("https://x", {
        method: "POST",
        headers: { "Content-Length": "10" },
        body: stream,
        duplex: "half",
      } as RequestInit);
      const read = await readBoundedUtf8RequestBody(req, MAX_QSTASH_SIGNED_BODY_BYTES);
      assert.equal(read.ok, false);
      if (!read.ok) {
        assert.equal(read.code, "qstash_signed_body_too_large");
      }
    });

    it("T26: body stream read failure is contained", async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull() {
          return Promise.reject(new Error("stream_broken"));
        },
      });
      const req = new Request("https://x", {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit);
      const read = await readBoundedUtf8RequestBody(req, MAX_QSTASH_SIGNED_BODY_BYTES);
      assert.equal(read.ok, false);
      if (!read.ok) {
        assert.equal(read.code, "qstash_signed_body_read_failed");
      }
    });

    it("T27: unsigned requests do not consume the body via observe helper", async () => {
      let processCalls = 0;
      const req = new Request("https://x", { method: "POST", body: "payload" });
      await observeVerifiedQstashPrimaryHeartbeat(req, {
        processVerified: async () => {
          processCalls += 1;
          return { status: "internal_failure", code: "qstash_processing_internal_failure" };
        },
      });
      assert.equal(processCalls, 0);
      const after = await req.text();
      assert.equal(after, "payload");
    });
  });

  it("T30: sanitized logs exclude signature, body, jti, and message id", async () => {
    const SIGNATURE_SENTINEL = "UPSTASH_SIG_SENTINEL_T30_9f3a2b";
    const BODY_SENTINEL = "RAW_BODY_SENTINEL_T30_7c4d1e";
    const JTI_SENTINEL = "SIGNED_JTI_SENTINEL_T30_8e5f6a";
    const MESSAGE_ID_SENTINEL = "UNTRUSTED_MSG_ID_SENTINEL_T30_1a2b3c";
    const CRON_SECRET_SENTINEL = "CRON_SECRET_SENTINEL_T30_must_never_log";

    const captured: unknown[] = [];
    const originalInfo = console.info;
    const originalError = console.error;
    console.info = (...args: unknown[]) => {
      captured.push(args);
      originalInfo.apply(console, args);
    };
    console.error = (...args: unknown[]) => {
      captured.push(args);
      originalError.apply(console, args);
    };

    try {
      await handleMarketingPublishCron(
        requestWithOptionalSignature({
          signature: SIGNATURE_SENTINEL,
          body: BODY_SENTINEL,
          messageId: MESSAGE_ID_SENTINEL,
        }),
        baseDeps({
          authorize: async () => ({ ok: true, reason: CRON_SECRET_SENTINEL }),
          observeVerifiedQstashPrimaryHeartbeat: async (req) => {
            await observeVerifiedQstashPrimaryHeartbeat(req, {
              processVerified: async (input) => {
                assert.equal(input.signature, SIGNATURE_SENTINEL);
                assert.equal(input.rawBody, BODY_SENTINEL);
                assert.equal(input.untrustedMessageId, MESSAGE_ID_SENTINEL);
                return {
                  status: "recorded",
                  outcome: "advanced",
                  jti: JTI_SENTINEL,
                  lastSeenAt: "2026-01-01T00:00:00.000Z",
                };
              },
            });
          },
        }),
      );

      const serializedCapture = JSON.stringify(captured);
      const heartbeatLogEvents = captured.filter((args) =>
        JSON.stringify(args).includes("qstash_primary_heartbeat"),
      );
      assert.ok(
        heartbeatLogEvents.length >= 1,
        "expected at least one qstash_primary_heartbeat log event",
      );

      const heartbeatSerialized = JSON.stringify(heartbeatLogEvents);
      assert.match(heartbeatSerialized, /qstash_primary_heartbeat/);
      assert.match(heartbeatSerialized, /recorded\/advanced/);

      assert.doesNotMatch(serializedCapture, new RegExp(SIGNATURE_SENTINEL));
      assert.doesNotMatch(serializedCapture, new RegExp(BODY_SENTINEL));
      assert.doesNotMatch(serializedCapture, new RegExp(JTI_SENTINEL));
      assert.doesNotMatch(serializedCapture, new RegExp(MESSAGE_ID_SENTINEL));
      assert.doesNotMatch(serializedCapture, new RegExp(CRON_SECRET_SENTINEL));
      assert.doesNotMatch(serializedCapture, /stream_broken/);
    } finally {
      console.info = originalInfo;
      console.error = originalError;
    }
  });
});
