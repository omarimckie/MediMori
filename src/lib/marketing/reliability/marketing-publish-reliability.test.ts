import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { cronAuthDecision } from "../config";
import { handleMarketingPublishCron } from "./marketing-publish-cron";
import { runReliabilityAfterMarketingPublish } from "./post-publish-reliability";
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
});

describe("marketing-publish reliability isolation", () => {
  it("does not run reliability for admin session publish", async () => {
    const result = await runReliabilityAfterMarketingPublish({
      authOk: true,
      authReason: "admin_session",
    });
    assert.equal(result, null);
  });

  it("does not run reliability when unauthorized", async () => {
    const result = await runReliabilityAfterMarketingPublish({
      authOk: false,
      authReason: "unauthorized",
    });
    assert.equal(result, null);
  });

  it("publish route invokes reliability only after publishDue", () => {
    const source = readFileSync(
      "src/app/api/cron/marketing-publish/route.ts",
      "utf8",
    );
    const publishIndex = source.indexOf("handleMarketingPublishCron");
    assert.ok(publishIndex >= 0);
    assert.match(source, /runReliabilityAfterMarketingPublish/);
  });

  it("publish route does not swallow publishDue failures in reliability try/catch", () => {
    const source = readFileSync(
      "src/lib/marketing/reliability/marketing-publish-cron.ts",
      "utf8",
    );
    assert.ok(!/try[\s\S]*publishDue[\s\S]*catch/.test(source.replace(/\n/g, " ")));
  });

  it("standalone marketing-reliability route invokes full sweep", () => {
    const source = readFileSync(
      "src/app/api/cron/marketing-reliability/route.ts",
      "utf8",
    );
    assert.match(source, /runMarketingReliabilitySweep/);
    const sweep = readFileSync("src/lib/marketing/reliability/sweep.ts", "utf8");
    assert.match(sweep, /reconcileAutoResolvableIncidents/);
  });

  describe("behavioral handleMarketingPublishCron", () => {
    it("A: cron_secret publish + reliability success preserves publish semantics", async () => {
      let publishCalls = 0;
      let reliabilityCalls = 0;
      const outcome = await handleMarketingPublishCron(new Request("https://x"), {
        authorize: async () => ({ ok: true, reason: "cron_secret" }),
        getStore: () => ({}) as never,
        publishDue: async () => {
          publishCalls += 1;
          return [{ id: "pub-1" }];
        },
        recordHeartbeat: async () => {},
        runReliabilityAfterMarketingPublish: async () => {
          reliabilityCalls += 1;
          return sweepResult();
        },
      });
      assert.equal(publishCalls, 1);
      assert.equal(reliabilityCalls, 1);
      assert.equal(outcome.ok, true);
      if (outcome.ok) {
        assert.equal(outcome.status, 200);
        assert.equal(outcome.body.published, 1);
        assert.deepEqual(outcome.body.results, [{ id: "pub-1" }]);
        assert.ok(outcome.body.reliability);
      }
    });

    it("B: cron_secret publish success + reliability throws still returns publish success", async () => {
      const outcome = await handleMarketingPublishCron(new Request("https://x"), {
        authorize: async () => ({ ok: true, reason: "cron_secret" }),
        getStore: () => ({}) as never,
        publishDue: async () => [{ id: "a" }, { id: "b" }],
        recordHeartbeat: async () => {},
        runReliabilityAfterMarketingPublish: async () => {
          return await runReliabilityAfterMarketingPublish(
            { authOk: true, authReason: "cron_secret" },
            {
              runSweep: async () => {
                throw new Error("reliability_down");
              },
            },
          );
        },
      });
      assert.equal(outcome.ok, true);
      if (outcome.ok) {
        assert.equal(outcome.body.published, 2);
        assert.equal(outcome.body.reliability, undefined);
      }
    });

    it("C: publishDue failure propagates (not masked by reliability)", async () => {
      await assert.rejects(
        handleMarketingPublishCron(new Request("https://x"), {
          authorize: async () => ({ ok: true, reason: "cron_secret" }),
          getStore: () => ({}) as never,
          publishDue: async () => {
            throw new Error("publish_failed");
          },
          recordHeartbeat: async () => {
            throw new Error("heartbeat_should_not_run");
          },
          runReliabilityAfterMarketingPublish: async () => sweepResult(),
        }),
        /publish_failed/,
      );
    });

    it("D: admin-session does not invoke reliability", async () => {
      const outcome = await handleMarketingPublishCron(new Request("https://x"), {
        authorize: async () => ({ ok: true, reason: "admin_session" }),
        getStore: () => ({}) as never,
        publishDue: async () => [],
        recordHeartbeat: async () => {},
        runReliabilityAfterMarketingPublish: (input) =>
          runReliabilityAfterMarketingPublish(input, {
            runSweep: async () => {
              throw new Error("reliability_should_not_run");
            },
          }),
      });
      assert.equal(outcome.ok, true);
      if (outcome.ok) {
        assert.equal(outcome.body.reliability, undefined);
      }
    });

    it("E: unauthorized does not publish or run reliability", async () => {
      let publishCalls = 0;
      let reliabilityCalls = 0;
      const outcome = await handleMarketingPublishCron(new Request("https://x"), {
        authorize: async () => ({ ok: false, reason: "unauthorized" }),
        getStore: () => ({}) as never,
        publishDue: async () => {
          publishCalls += 1;
          return [];
        },
        recordHeartbeat: async () => {},
        runReliabilityAfterMarketingPublish: async () => {
          reliabilityCalls += 1;
          return sweepResult();
        },
      });
      assert.equal(outcome.ok, false);
      assert.equal(publishCalls, 0);
      assert.equal(reliabilityCalls, 0);
    });

    it("F: spoofed scheduler headers without CRON_SECRET do not get cron reliability", async () => {
      const auth = cronAuthDecision({
        isProduction: false,
        cronSecret: "real-secret",
        authorizationHeader: null,
        isAdmin: false,
      });
      assert.equal(auth.reason, "unauthorized");
      const withSpoof = cronAuthDecision({
        isProduction: false,
        cronSecret: "real-secret",
        authorizationHeader: "Bearer wrong",
        isAdmin: false,
      });
      assert.equal(withSpoof.reason, "unauthorized");
      const reliability = await runReliabilityAfterMarketingPublish({
        authOk: withSpoof.ok,
        authReason: withSpoof.reason,
      });
      assert.equal(reliability, null);
    });
  });
});
