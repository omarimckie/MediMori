import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatEvidenceEntries,
  formatPermittedActionLabel,
  formatIncidentTypeLabel,
  formatRetrySafetyLabel,
  lifecycleActionsForStatus,
  MANUAL_RESOLUTION_OPTIONS,
  incidentNeedsResolveSafetyWarning,
  RESOLVE_PRIMARY_WARNING,
  RESOLVE_SAFETY_BLOCK_WARNING,
} from "./incident-admin-presenters";

describe("Incident admin presenters", () => {
  it("formats incident type labels", () => {
    assert.equal(formatIncidentTypeLabel("publication_ambiguous"), "Ambiguous publish outcome");
  });

  it("formats retry-safety labels", () => {
    assert.match(formatRetrySafetyLabel("safe_automatic"), /Automatic retry may be appropriate/);
    assert.match(formatRetrySafetyLabel("unsafe_duplicate_risk"), /duplicate publication risk/);
  });

  it("exposes only manual resolution options for III-A3 UI", () => {
    assert.deepEqual(
      MANUAL_RESOLUTION_OPTIONS.map((o) => o.value),
      ["owner_resolved", "false_positive"],
    );
    const labels = MANUAL_RESOLUTION_OPTIONS.map((o) => o.label).join(" ");
    assert.match(labels, /Resolved by owner/);
    assert.match(labels, /Not actually an issue/);
    assert.doesNotMatch(labels, /auto_recovered|superseded/i);
  });

  it("lifecycle actions exclude resolve and match open matrix", () => {
    const open = lifecycleActionsForStatus("open").map((a) => a.label);
    assert.deepEqual(open.sort(), ["Mark blocked", "Needs action", "Start investigation"].sort());
    assert.equal(lifecycleActionsForStatus("resolved").length, 0);
  });

  it("flags ambiguity and recovery types for resolve warnings", () => {
    assert.equal(incidentNeedsResolveSafetyWarning("publication_ambiguous"), true);
    assert.equal(incidentNeedsResolveSafetyWarning("publication_recovery_required"), true);
    assert.equal(incidentNeedsResolveSafetyWarning("publication_failed"), false);
  });

  it("resolve warnings state operational closure limits", () => {
    assert.match(RESOLVE_PRIMARY_WARNING, /does not fix the publication/i);
    assert.match(RESOLVE_PRIMARY_WARNING, /clear ambiguity/i);
    assert.match(RESOLVE_PRIMARY_WARNING, /enable retry/i);
    assert.match(RESOLVE_PRIMARY_WARNING, /call Meta/i);
    assert.match(RESOLVE_SAFETY_BLOCK_WARNING, /safety blocks may still apply/i);
  });

  it("unknown permitted action renders neutral text only", () => {
    const label = formatPermittedActionLabel("future_unknown_action");
    assert.equal(label, "future unknown action");
    assert.doesNotMatch(label, /button|retry publication/i);
  });

  it("lifecycle actions for open never include resolved", () => {
    const source = lifecycleActionsForStatus("open");
    assert.ok(!source.some((a) => a.targetStatus === "resolved"));
    assert.ok(!source.some((a) => a.label.toLowerCase().includes("retry")));
  });

  it("formatEvidenceEntries skips empties and stringifies nested values safely", () => {
    const entries = formatEvidenceEntries({
      empty: "",
      nil: null,
      flag: true,
      count: 42,
      nested: { a: 1 },
      list: [1, 2],
      long: "x".repeat(200),
    });
    const keys = entries.map((e) => e.key);
    assert.ok(!keys.includes("empty"));
    assert.ok(!keys.includes("nil"));
    assert.ok(keys.includes("nested"));
    assert.ok(keys.includes("list"));
    const nested = entries.find((e) => e.key === "nested");
    assert.match(nested?.value ?? "", /"a": 1/);
    assert.equal(entries.find((e) => e.key === "flag")?.value, "true");
  });
});
