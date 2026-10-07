import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MarketingPublication } from "../types";
import { PUBLICATION_OVERDUE_THRESHOLD_MS } from "../reliability/constants";
import {
  evaluateOverdueAutoResolve,
  evaluateStuckAutoResolve,
  publicationRowBlocksAutoResolve,
} from "./auto-resolve-policy";

function pub(patch: Partial<MarketingPublication> & { id: string }): MarketingPublication {
  const now = new Date().toISOString();
  return {
    contentId: "content-1",
    campaignId: null,
    platform: "instagram",
    provider: "instagram",
    status: "scheduled",
    idempotencyKey: `k:${patch.id}`,
    externalId: null,
    url: null,
    attemptCount: 0,
    lastError: null,
    scheduledFor: now,
    publishedAt: null,
    ambiguityState: "none",
    claimToken: null,
    processingStartedAt: null,
    providerCreationId: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

describe("auto-resolve policy", () => {
  it("overdue: published resolves", () => {
    const decision = evaluateOverdueAutoResolve(pub({ id: "p1", status: "published" }));
    assert.equal(decision.action, "resolve");
  });

  it("overdue: clean failed resolves", () => {
    const decision = evaluateOverdueAutoResolve(pub({ id: "p2", status: "failed" }));
    assert.equal(decision.action, "resolve");
  });

  it("overdue: still overdue skips", () => {
    const scheduledFor = new Date(Date.now() - PUBLICATION_OVERDUE_THRESHOLD_MS - 60_000).toISOString();
    const decision = evaluateOverdueAutoResolve(
      pub({ id: "p3", status: "scheduled", scheduledFor }),
    );
    assert.equal(decision.action, "skip");
  });

  it("overdue: future schedule resolves", () => {
    const scheduledFor = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const decision = evaluateOverdueAutoResolve(
      pub({ id: "p4", status: "scheduled", scheduledFor }),
    );
    assert.equal(decision.action, "resolve");
  });

  it("overdue: scheduled without scheduled_for skips", () => {
    const decision = evaluateOverdueAutoResolve(
      pub({ id: "p5", status: "scheduled", scheduledFor: null }),
    );
    assert.equal(decision.action, "skip");
  });

  it("stuck: still processing skips", () => {
    const decision = evaluateStuckAutoResolve(
      pub({ id: "s1", status: "processing", updatedAt: new Date().toISOString() }),
    );
    assert.equal(decision.action, "skip");
  });

  it("stuck: published resolves", () => {
    const decision = evaluateStuckAutoResolve(pub({ id: "s2", status: "published" }));
    assert.equal(decision.action, "resolve");
  });

  it("stuck: failed resolves", () => {
    const decision = evaluateStuckAutoResolve(pub({ id: "s3", status: "failed" }));
    assert.equal(decision.action, "resolve");
  });

  it("row blocker: ambiguity_state", () => {
    const blocked = publicationRowBlocksAutoResolve(
      pub({ id: "b1", ambiguityState: "ambiguous" }),
    );
    assert.equal(blocked.blocked, true);
  });

  it("row blocker: inflight sentinel", () => {
    const blocked = publicationRowBlocksAutoResolve(
      pub({ id: "b2", status: "processing", providerCreationId: "__publish_inflight__" }),
    );
    assert.equal(blocked.blocked, true);
  });

  it("row blocker: instagram recovery required", () => {
    const blocked = publicationRowBlocksAutoResolve(
      pub({
        id: "b3",
        status: "failed",
        platform: "instagram",
        providerCreationId: "18104922968283771",
        externalId: null,
      }),
    );
    assert.equal(blocked.blocked, true);
  });

  it("publication status union: known statuses are classified (fail-closed on unknown)", () => {
    const known: Array<MarketingPublication["status"]> = [
      "queued",
      "scheduled",
      "processing",
      "published",
      "failed",
    ];
    for (const status of known) {
      const decision =
        status === "processing"
          ? evaluateStuckAutoResolve(pub({ id: `k-${status}`, status }))
          : evaluateOverdueAutoResolve(pub({ id: `k-${status}`, status }));
      assert.ok(decision.action === "resolve" || decision.action === "skip");
    }
    const unknown = evaluateOverdueAutoResolve(
      pub({ id: "unknown", status: "draft" as MarketingPublication["status"] }),
    );
    assert.equal(unknown.action, "skip");
    assert.match(String(unknown.reason), /unsupported_status/);
  });
});
