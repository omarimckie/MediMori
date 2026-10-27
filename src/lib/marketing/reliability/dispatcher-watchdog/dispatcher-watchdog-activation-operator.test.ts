import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeWatchdogPgHarness } from "./fake-pg-harness";

const BASE = new Date("2026-10-19T12:00:00.000Z");

function atMinuteOffset(minutes: number): Date {
  return new Date(BASE.getTime() + minutes * 60_000);
}

describe("dispatcher watchdog activation operator repository contract", () => {
  it("rejects activation without verified evidence", async () => {
    const { repo } = createFakeWatchdogPgHarness();
    await assert.rejects(
      () => repo.recordPrimaryQstashActivation(atMinuteOffset(0)),
      /watchdog_activation_requires_verified_qstash_evidence/,
    );
  });

  it("idempotent second activation with valid evidence", async () => {
    const { repo } = createFakeWatchdogPgHarness();
    const evidence = {
      verificationKind: "qstash_signature_verified" as const,
      verifiedAt: atMinuteOffset(0).toISOString(),
      attestationId: "operator-jti-1",
    };
    const first = await repo.recordPrimaryQstashActivation(atMinuteOffset(0), evidence);
    assert.ok(first.primaryQstashActivatedAt);
    const second = await repo.recordPrimaryQstashActivation(atMinuteOffset(5), evidence);
    assert.equal(second.primaryQstashActivatedAt, first.primaryQstashActivatedAt);
  });
});
