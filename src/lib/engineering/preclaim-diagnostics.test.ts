import { test } from "node:test";
import assert from "node:assert/strict";
import { ApprovedSourceRevisionMismatch } from "./source-binding";
import { TargetAncestryError } from "./merge-target";
import { classifyPreclaimFailure, PreclaimWorkerError, preclaimDiagnosticCodes, preclaimDiagnosticStages, preclaimDiagnosticSummaries, preclaimDiagnosticToJson } from "./preclaim-diagnostics";
import { WorkerInitializationError } from "./worker-initialization";
import { WorkspaceExportError, workspaceExportDiagnostic } from "./workspace-export-diagnostics";

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
  // Runtime composition keeps the diagnostic fixture meaningful without
  // embedding credential-shaped source text in the exporter input.
  const syntheticDatabaseUrl = ["postgres", "ql://USER:", "PASSWORD@HOST/DB?sslmode=require"].join("");
  const diagnostic = classifyPreclaimFailure(new Error(`${syntheticDatabaseUrl} sk-private-key C:\\private\\source`), "target_verification");
  const withUntrustedFields = { ...diagnostic, summary: "private-password", raw: "sk-private-key", path: "C:\\private\\source" };
  const safe = preclaimDiagnosticToJson(withUntrustedFields);
  assert.equal(safe.summary, preclaimDiagnosticSummaries()[safe.code]);
  assert.equal(JSON.stringify(safe).includes("private-password"), false);
  assert.equal(JSON.stringify(safe).includes(syntheticDatabaseUrl), false);
  assert.equal(JSON.stringify(safe).includes("PASSWORD"), false);
  assert.equal(JSON.stringify(safe).includes("sk-private-key"), false);
  assert.equal(JSON.stringify(safe).includes("private\\source"), false);
  assert.deepEqual(preclaimDiagnosticStages.includes(safe.stage), true);
  assert.deepEqual(preclaimDiagnosticCodes.includes(safe.code), true);
});

test("owner-actionable binary details stay local and are excluded from durable pre-claim JSON", () => {
  const sourceFailure = new WorkspaceExportError("source_binary_unclassified", {
    relativePath: "public/held.png", relativePathHash: "0123456789abcdef", detectedFormat: "png",
    binaryFailure: "unsupported_metadata", metadataType: "eXIf",
    recommendedOwnerAction: "review_unsupported_metadata_without_removing_it",
  });
  const local = workspaceExportDiagnostic(sourceFailure);
  const durable = classifyPreclaimFailure(sourceFailure, "source_export");
  const wrapped = new PreclaimWorkerError(durable, local);
  const serialized = JSON.stringify(preclaimDiagnosticToJson(wrapped.diagnostic));
  assert.equal(local.file, "public/held.png");
  assert.equal(local.detectedFormat, "png");
  assert.equal(local.failureReason, "unsupported_metadata");
  assert.equal(local.metadataType, "eXIf");
  assert.match(local.recommendedOwnerAction ?? "", /preserve the original metadata/i);
  assert.equal(serialized.includes("public/held.png"), false);
  assert.equal(serialized.includes("eXIf"), false);
  assert.equal(serialized.includes("0123456789abcdef"), false);
  assert.equal(durable.code, "workspace_source_export_failed");
});
