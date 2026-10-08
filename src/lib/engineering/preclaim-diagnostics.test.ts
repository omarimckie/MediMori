import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovedSourceRevisionMismatch } from "./source-binding";
import { TargetAncestryError } from "./merge-target";
import { classifyPreclaimFailure, preclaimDiagnosticCodes, preclaimDiagnosticStages, preclaimDiagnosticSummaries, preclaimDiagnosticToJson } from "./preclaim-diagnostics";
import { WorkerInitializationError } from "./worker-initialization";
import { WorkspaceExportError } from "./workspace-export-diagnostics";

test("pre-claim diagnostics classify target, source, export, identity, lineage, and scratch failures", () => {
  const cases = [
    [new TargetAncestryError("target_commit_missing"), "target_verification", "target_object_missing"],
    [new TargetAncestryError("target_not_ancestor"), "target_verification", "target_not_ancestor"],
    [new TargetAncestryError("target_fetch_failed"), "target_verification", "target_unavailable"],
    [new ApprovedSourceRevisionMismatch(), "source_export", "source_revision_mismatch"],
    [new WorkspaceExportError("source_file_read_failed"), "source_export", "workspace_source_export_failed"],
    [new WorkerInitializationError("database_identity", "worker_database_identity_mismatch"), "database_identity", "worker_identity_or_schema_failure"],
    [new WorkerInitializationError("scratch_preflight", "scratch_path_inaccessible"), "scratch_preflight", "scratch_storage_preflight_failure"],
    [new Error("private URL, key, path, and stack"), "lineage_lookup", "invalid_lineage_binding"],
  ] as const;
  for (const [error, stage, code] of cases) {
    const result = classifyPreclaimFailure(error, stage);
    assert.equal(result.stage, stage);
    assert.equal(result.code, code);
    assert.equal(result.beforeClaim, true);
    assert.equal(result.providerCouldHaveBeenReached, false);
    assert.equal(result.dockerCouldHaveBeenReached, false);
  }
});

test("serialized pre-claim diagnostics reconstruct only bounded allow-listed metadata", () => {
  const diagnostic = classifyPreclaimFailure(new Error("postgres://private-user:private-password@secret-host sk-private-key C:\\private\\source"), "target_verification");
  const withUntrustedFields = { ...diagnostic, summary: "private-password", raw: "sk-private-key", path: "C:\\private\\source" };
  const safe = preclaimDiagnosticToJson(withUntrustedFields);
  assert.equal(safe.summary, preclaimDiagnosticSummaries()[safe.code]);
  assert.equal(JSON.stringify(safe).includes("private-password"), false);
  assert.equal(JSON.stringify(safe).includes("sk-private-key"), false);
  assert.equal(JSON.stringify(safe).includes("private\\source"), false);
  assert.deepEqual(preclaimDiagnosticStages.includes(safe.stage), true);
  assert.deepEqual(preclaimDiagnosticCodes.includes(safe.code), true);
});
