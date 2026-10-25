import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { getSql } from "@/lib/db";
import { approvePreparedAttempt, authorizePreparedExecution, createTask, prepareInitialAttempt, taskHistory, actOnTask as storeActOnTask } from "./store";
import { safeBlockDiagnostic } from "./event-diagnostics";
import { prepareValidationEnvironmentDiagnostic } from "./prepare-validation-failure";
import { classifyPreparationFailure, ValidationPreparationError, preparationFailureClasses, withStagingCleanupFailure } from "./validation-diagnostics";
import { validationPreparationOperations } from "./validation-source-populate";
import { buildWorkerExitReport } from "./worker-exit-report";
import { DockerCleanupError } from "./docker-ownership";
import { EngineeringInputError } from "./policy";
import type { WorkerDiagnostic } from "./worker";

const revision = "c0b87c83efeab8d0e42b7b4573401dbea7424c35";
const secretStderr = "stderr-sentinel postgres://worker:secret-token@db.example/neondb --password=secret-token";
const secretPath = "D:\\MediMori-Engineering\\source-policy-v2-lf-36f9653";

test("preparation failure classes come from error codes and ignore messages", () => {
  assert.equal(classifyPreparationFailure(Object.assign(new Error(secretStderr), { code: "TAR_FAILED", stderr: secretStderr, path: secretPath })), "subprocess_nonzero_exit");
  assert.equal(classifyPreparationFailure(Object.assign(new Error(secretPath), { code: 125, stderr: secretStderr })), "subprocess_nonzero_exit");
  assert.equal(classifyPreparationFailure(Object.assign(new Error("Populate timed out."), { code: "ETIMEDOUT", killed: true, stderr: secretStderr })), "subprocess_timeout");
  assert.equal(classifyPreparationFailure(Object.assign(new Error(secretPath), { code: "ENOENT", path: secretPath })), "filesystem_operation_failed");
  assert.equal(classifyPreparationFailure(Object.assign(new Error(secretStderr), { code: "DOCKER_POPULATE_FAILED", stderr: secretStderr })), "docker_process_failed");
  assert.equal(classifyPreparationFailure(Object.assign(new Error(secretStderr), { code: "UNTRUSTED_DETAIL", stderr: secretStderr })), "preparation_failure");
  assert.equal(classifyPreparationFailure("postgres://worker:secret-token@db.example/neondb"), "preparation_failure");
  assert.equal(classifyPreparationFailure({ killed: true, stderr: secretStderr }), "subprocess_timeout");
  assert.equal(classifyPreparationFailure({ code: 0, stderr: secretStderr }), "preparation_failure");
  assert.equal(classifyPreparationFailure({ code: 1.5, path: secretPath }), "preparation_failure");
  assert.equal(classifyPreparationFailure({ code: { exit: 1 }, message: secretStderr }), "preparation_failure");
  assert.equal(classifyPreparationFailure({ code: "ENOENT ", path: secretPath }), "preparation_failure");
  assert.equal(classifyPreparationFailure(null), "preparation_failure");
});

test("every allowlisted preparation operation and failure class survives the application projection", () => {
  for (const operation of validationPreparationOperations) {
    for (const failureClass of preparationFailureClasses) {
      const diagnostic = prepareValidationEnvironmentDiagnostic(
        new ValidationPreparationError("validation_source_prepare_failed", "source_volume", operation, false, failureClass),
        revision,
      );
      const safe = safeBlockDiagnostic("block", diagnostic);
      assert.equal(safe?.validationPreparationOperation, operation);
      assert.equal(safe?.preparationFailureClass, failureClass);
      assert.equal(safe?.code, "validation_source_prepare_failed");
      assert.equal(safe?.validationStage, "source_volume");
    }
  }
});

test("malformed preparation metadata is omitted and cannot carry arbitrary text", () => {
  const malformed = new ValidationPreparationError(
    "validation_source_prepare_failed",
    "source_volume",
    "docker_populate_workspace\npostgres://worker:secret-token@db.example/neondb" as "docker_populate_workspace",
    false,
    "subprocess_timeout\u0000secret-token" as "subprocess_timeout",
  );
  assert.equal(malformed.operation, undefined);
  assert.equal(malformed.failureClass, undefined);
  assert.equal(malformed.message, "Validation environment preparation failed.");
  assert.equal(JSON.stringify(malformed).includes("secret-token"), false);
  const safe = safeBlockDiagnostic("block", {
    code: "validation_source_prepare_failed",
    stage: "worker",
    validationStage: "source_volume",
    validationPreparationOperation: { operation: "docker_populate_workspace", path: secretPath },
    preparationFailureClass: ["subprocess_timeout", secretStderr],
    stderr: secretStderr,
  });
  assert.deepEqual(safe, { code: "validation_source_prepare_failed", stage: "worker", validationStage: "source_volume" });
  for (const value of [null, 1, "", " local_staging_export", "LOCAL_STAGING_EXPORT", ["docker_populate_workspace"]]) {
    const projected = safeBlockDiagnostic("block", {
      code: "validation_source_prepare_failed",
      validationStage: "source_volume",
      validationPreparationOperation: value,
      preparationFailureClass: value,
    });
    assert.equal(projected?.validationPreparationOperation, undefined);
    assert.equal(projected?.preparationFailureClass, undefined);
    assert.equal(JSON.stringify(projected).includes("secret"), false);
  }
});

test("known preparation operation and failure class stay with the primary source_volume diagnostic", () => {
  const diagnostic = prepareValidationEnvironmentDiagnostic(
    new ValidationPreparationError("validation_source_prepare_failed", "source_volume", "docker_populate_workspace", false, "docker_process_failed"),
    revision,
  );
  assert.equal(diagnostic.code, "validation_source_prepare_failed");
  assert.equal(diagnostic.validationStage, "source_volume");
  assert.equal(diagnostic.validationPreparationOperation, "docker_populate_workspace");
  assert.equal(diagnostic.preparationFailureClass, "docker_process_failed");
  assert.equal(diagnostic.cleanupOutcome, undefined);
});

test("unknown preparation operation and failure class are omitted", () => {
  const safe = safeBlockDiagnostic("block", {
    code: "validation_source_prepare_failed",
    stage: "worker",
    validationStage: "source_volume",
    validationPreparationOperation: "docker_populate_workspace;secret-token",
    preparationFailureClass: "stderr-sentinel",
    stderr: secretStderr,
    message: secretPath,
    args: ["--password=secret-token"],
  });
  assert.deepEqual(safe, { code: "validation_source_prepare_failed", stage: "worker", validationStage: "source_volume" });
  assert.equal(JSON.stringify(safe).includes("secret"), false);
  assert.equal(JSON.stringify(safe).includes("MediMori-Engineering"), false);
  assert.equal(JSON.stringify(safe).includes("stderr"), false);
});

test("historical source_volume failure does not gain an invented operation or failure class", () => {
  const diagnostic = prepareValidationEnvironmentDiagnostic(
    new ValidationPreparationError("validation_source_prepare_failed", "source_volume"),
    revision,
  );
  assert.equal(diagnostic.code, "validation_source_prepare_failed");
  assert.equal(diagnostic.validationStage, "source_volume");
  assert.equal(diagnostic.validationPreparationOperation, undefined);
  assert.equal(diagnostic.preparationFailureClass, undefined);
  const report = buildWorkerExitReport({
    primary: diagnostic as WorkerDiagnostic,
    cleanupOutcome: "succeeded",
    cleanupFailures: [],
    terminalization: { attempted: true, blockRecorded: true },
  });
  assert.equal(report.primary.code, "validation_source_prepare_failed");
  assert.equal(report.primary.validationStage, "source_volume");
  assert.equal(report.primary.validationPreparationOperation, undefined);
  assert.equal(report.primary.preparationFailureClass, undefined);
  assert.equal(report.cleanupOutcome, "succeeded");
});

test("exit report keeps allowlisted preparation metadata and drops sensitive fields", () => {
  const populated = {
    stage: "worker",
    operation: "prepare_validation_environment",
    category: "validation_failure",
    code: "validation_source_prepare_failed",
    validationStage: "source_volume",
    validationRevision: revision,
    validationPreparationOperation: "local_staging_export",
    preparationFailureClass: "filesystem_operation_failed",
    cleanupOutcome: "succeeded",
    stderr: secretStderr,
    message: secretPath,
    args: ["--password=secret-token"],
  } as WorkerDiagnostic;
  const report = buildWorkerExitReport({
    primary: populated,
    cleanupOutcome: "succeeded",
    cleanupFailures: [],
    terminalization: { attempted: true, blockRecorded: true },
  });
  assert.equal(report.primary.code, "validation_source_prepare_failed");
  assert.equal(report.primary.validationStage, "source_volume");
  assert.equal(report.primary.validationPreparationOperation, "local_staging_export");
  assert.equal(report.primary.preparationFailureClass, "filesystem_operation_failed");
  assert.equal(report.cleanupOutcome, "succeeded");
  const encoded = JSON.stringify(report);
  assert.equal(encoded.includes("secret-token"), false);
  assert.equal(encoded.includes("postgres://"), false);
  assert.equal(encoded.includes("MediMori-Engineering"), false);
  assert.equal(encoded.includes("stderr-sentinel"), false);
  assert.equal(encoded.includes("--password"), false);
});

test("cleanup failure stays separate from the primary preparation diagnostic", () => {
  const primary = withStagingCleanupFailure(new ValidationPreparationError("validation_source_prepare_failed", "source_volume", "docker_populate_workspace", false, "subprocess_timeout"));
  const diagnostic = prepareValidationEnvironmentDiagnostic(primary, revision);
  assert.equal(diagnostic.code, "validation_source_prepare_failed");
  assert.equal(diagnostic.validationStage, "source_volume");
  assert.equal(diagnostic.validationPreparationOperation, "docker_populate_workspace");
  assert.equal(diagnostic.preparationFailureClass, "subprocess_timeout");
  assert.equal(diagnostic.cleanupOutcome, "failed");
  assert.notEqual(diagnostic.code, "sandbox_cleanup_failed");
  const cleanupOnly = prepareValidationEnvironmentDiagnostic(new DockerCleanupError([{ resourceType: "source-volume", category: "docker_error" }]), revision);
  assert.equal(cleanupOnly.code, "sandbox_cleanup_failed");
  assert.equal(cleanupOnly.operation, "workspace_cleanup");
  assert.equal(cleanupOnly.preparationFailureClass, undefined);
  assert.equal(cleanupOnly.cleanupOutcome, "failed");
});

test("non-preparation failures keep their existing diagnostic shape", () => {
  const provider = safeBlockDiagnostic("block", { code: "provider_incomplete", stage: "worker", operation: "provider_call", category: "provider_failure", message: secretStderr });
  assert.deepEqual(provider, { operation: "provider_call", category: "provider_failure", code: "provider_incomplete", stage: "worker" });
  const input = prepareValidationEnvironmentDiagnostic(new EngineeringInputError("Workspace changed before volume population."), revision);
  assert.equal(input.code, "validation_source_prepare_failed");
  assert.equal(input.validationStage, "source_volume");
  assert.equal(input.preparationFailureClass, "preparation_failure");
  assert.equal(JSON.stringify(input).includes("Workspace changed"), false);
});

function sqlCaseAllowlist(sql: string, field: string): string[] {
  const match = sql.match(new RegExp(`'${field}',CASE WHEN data#>>'\\{diagnostic,${field}\\}' IN \\(([^)]+)\\)`));
  assert.ok(match, field);
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
}

test("sql block projection source allowlists the same preparation vocabulary", async () => {
  const sql = await readFile(new URL("../../../sql/engineering-worker.sql", import.meta.url), "utf8");
  assert.deepEqual(sqlCaseAllowlist(sql, "validationPreparationOperation"), [...validationPreparationOperations]);
  assert.deepEqual(sqlCaseAllowlist(sql, "preparationFailureClass"), [...preparationFailureClasses]);
});

test("sql block event stores allowlisted preparation metadata and drops sensitive values", async () => {
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "true";
  process.env.ENGINEERING_WORKER_ENABLED = "true";
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE medimori_engineering_2c_worker");
    for (const file of ["engineering-schema.sql", "engineering-worker.sql", "engineering-lineage.sql", "engineering-initial-attempt-preparation.sql", "engineering-source-binding.sql", "engineering-source-selection-policy.sql", "engineering-approval-execution-separation.sql", "engineering-prepared-subject-supersession.sql"]) {
      await db.exec(await readFile(new URL(`../../../sql/${file}`, import.meta.url), "utf8"));
    }
    const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => (await db.query(strings.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values)).rows) as unknown as ReturnType<typeof getSql>;
    const target = "c".repeat(40);
    const sourceRevision = "a".repeat(40);
    let task = await createTask("Diagnostic retention fixture", "human", randomUUID(), sql);
    task = await storeActOnTask(task.id, task.version, "transition", "analyzing", "human", sql);
    task = await storeActOnTask(task.id, task.version, "plan", { summary: "Bounded README proof", files: ["README.md"], operations: [], validations: ["test", "lint", "typecheck", "build", "security:check", "test:engineering"] }, "human", sql);
    await prepareInitialAttempt(task.id, task.version, randomUUID(), "human", sql, async () => target, async (_sha, paths) => Object.fromEntries(paths.map(path => [path, "d".repeat(64)])), async () => sourceRevision);
    task = (await taskHistory(task.id, sql)).task!;
    const prepared = (await sql`SELECT attempt_id FROM engineering_prepared_attempts WHERE task_id=${task.id}::uuid`)[0] as { attempt_id: string };
    await approvePreparedAttempt(task.id, task.version, prepared.attempt_id, "human", sql, async () => target, async (_sha, paths) => Object.fromEntries(paths.map(path => [path, "d".repeat(64)])), async () => sourceRevision);
    await authorizePreparedExecution(task.id, task.version, prepared.attempt_id, "human", sql, async () => target, async (_sha, paths) => Object.fromEntries(paths.map(path => [path, "d".repeat(64)])), async () => sourceRevision);
    const run = String((await taskHistory(task.id, sql)).runs[0].id);
    await db.query("SELECT engineering_worker($1::uuid,$2,$3,$4,$5::jsonb)", [run, "claim", "diag-retention", 0, JSON.stringify({ preflightRevision: sourceRevision })]);
    const epoch = Number((await db.query<{ lease_epoch: number }>("SELECT lease_epoch FROM engineering_runs WHERE id=$1::uuid", [run])).rows[0].lease_epoch);
    await db.query("SELECT engineering_worker($1::uuid,$2,$3,$4,$5::jsonb)", [run, "block", "diag-retention", epoch, JSON.stringify({
      diagnostic: {
        stage: "worker",
        operation: "prepare_validation_environment",
        category: "validation_failure",
        cleanupOutcome: "failed",
        code: "validation_source_prepare_failed",
        validationStage: "source_volume",
        validationRevision: revision,
        validationPreparationOperation: "docker_populate_workspace",
        preparationFailureClass: "docker_process_failed",
        stderr: secretStderr,
        message: secretPath,
        args: ["--password=secret-token"],
        cleanupFailures: [{ resourceType: "source-volume", category: "docker_error" }],
      },
    })]);
    const details = (await db.query<{ details: { diagnostic: Record<string, unknown> } }>("SELECT details FROM engineering_events WHERE task_id=$1 AND action='block'", [task.id])).rows[0].details;
    assert.deepEqual(details.diagnostic, {
      stage: "worker",
      operation: "prepare_validation_environment",
      category: "validation_failure",
      cleanupOutcome: "failed",
      code: "validation_source_prepare_failed",
      validationStage: "source_volume",
      validationRevision: revision,
      validationPreparationOperation: "docker_populate_workspace",
      preparationFailureClass: "docker_process_failed",
      cleanupFailures: [{ resourceType: "source-volume", category: "docker_error" }],
      responseId: "",
      responseStatus: "unknown",
    });
    const encoded = JSON.stringify(details);
    assert.equal(encoded.includes("secret-token"), false);
    assert.equal(encoded.includes("postgres://"), false);
    assert.equal(encoded.includes("MediMori-Engineering"), false);
    assert.equal(encoded.includes("stderr-sentinel"), false);
    const runRow = (await db.query<{ disposition: string }>("SELECT disposition FROM engineering_runs WHERE id=$1::uuid", [run])).rows[0];
    assert.equal(runRow.disposition, "blocked");
    let rejected = await createTask("Diagnostic rejection fixture", "human", randomUUID(), sql);
    rejected = await storeActOnTask(rejected.id, rejected.version, "transition", "analyzing", "human", sql);
    rejected = await storeActOnTask(rejected.id, rejected.version, "plan", { summary: "Bounded README proof", files: ["README.md"], operations: [], validations: ["test", "lint", "typecheck", "build", "security:check", "test:engineering"] }, "human", sql);
    await prepareInitialAttempt(rejected.id, rejected.version, randomUUID(), "human", sql, async () => target, async (_sha, paths) => Object.fromEntries(paths.map(path => [path, "d".repeat(64)])), async () => sourceRevision);
    rejected = (await taskHistory(rejected.id, sql)).task!;
    const rejectedPrepared = (await sql`SELECT attempt_id FROM engineering_prepared_attempts WHERE task_id=${rejected.id}::uuid`)[0] as { attempt_id: string };
    await approvePreparedAttempt(rejected.id, rejected.version, rejectedPrepared.attempt_id, "human", sql, async () => target, async (_sha, paths) => Object.fromEntries(paths.map(path => [path, "d".repeat(64)])), async () => sourceRevision);
    await authorizePreparedExecution(rejected.id, rejected.version, rejectedPrepared.attempt_id, "human", sql, async () => target, async (_sha, paths) => Object.fromEntries(paths.map(path => [path, "d".repeat(64)])), async () => sourceRevision);
    const rejectedRun = String((await taskHistory(rejected.id, sql)).runs[0].id);
    await db.query("SELECT engineering_worker($1::uuid,$2,$3,$4,$5::jsonb)", [rejectedRun, "claim", "diag-retention", 0, JSON.stringify({ preflightRevision: sourceRevision })]);
    const rejectedEpoch = Number((await db.query<{ lease_epoch: number }>("SELECT lease_epoch FROM engineering_runs WHERE id=$1::uuid", [rejectedRun])).rows[0].lease_epoch);
    await db.query("SELECT engineering_worker($1::uuid,$2,$3,$4,$5::jsonb)", [rejectedRun, "block", "diag-retention", rejectedEpoch, JSON.stringify({
      diagnostic: {
        code: "provider_incomplete",
        stage: "worker",
        operation: "provider_call",
        category: "provider_failure",
        validationPreparationOperation: "not_an_operation",
        preparationFailureClass: { class: "subprocess_timeout", detail: secretStderr },
        stderr: secretStderr,
        message: secretPath,
      },
    })]);
    const rejectedDetails = (await db.query<{ details: { diagnostic: Record<string, unknown> } }>("SELECT details FROM engineering_events WHERE task_id=$1 AND action='block'", [rejected.id])).rows[0].details;
    assert.equal(rejectedDetails.diagnostic.code, "provider_incomplete");
    assert.equal(rejectedDetails.diagnostic.operation, "provider_call");
    assert.equal(rejectedDetails.diagnostic.validationPreparationOperation, undefined);
    assert.equal(rejectedDetails.diagnostic.preparationFailureClass, undefined);
    assert.equal(JSON.stringify(rejectedDetails).includes("secret-token"), false);
    assert.equal(JSON.stringify(rejectedDetails).includes("MediMori-Engineering"), false);
  } finally {
    await db.close();
    delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED;
    delete process.env.ENGINEERING_WORKER_ENABLED;
  }
});
