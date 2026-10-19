import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { boundedValidationExcerpt, makeValidationEvidence, normalizeValidationEvidence, sanitizeValidationLabel, ValidationPreparationError, validationPreparationCodes, withStagingCleanupFailure } from "./validation-diagnostics";

const revision = "a".repeat(40);

test("validation evidence retains bounded failure metadata and safe test identifiers", () => {
  const evidence = makeValidationEvidence({
    revision, command: "test:engineering", exitCode: 1, cycle: 2,
    output: ["not ok 42 - offline diagnostic passes real config and read-only scratch preflight without external side effects", "AssertionError: expected sensitive fixture content"].join("\n"),
  });
  assert.equal(evidence.category, "command_failed");
  assert.equal(evidence.exitCode, 1);
  assert.deepEqual(evidence.failedTests, ["offline diagnostic passes real config and read-only scratch preflight without external side effects"]);
  assert.equal(JSON.stringify(evidence).includes("sensitive fixture content"), false);
  assert.equal(evidence.cycle, 2);
});

test("validation evidence bounds, redacts and classifies build signals/timeouts", () => {
  const secret = ["postgresql://", "private:password@host/db", " sk-private_key_value"].join("");
  const evidence = makeValidationEvidence({ revision, command: "build", exitCode: 70, signal: "SIGSEGV", cycle: 0, output: `Next.js 16.2.4\n${secret}\n${"x".repeat(2000)}` });
  assert.equal(evidence.category, "process_signaled");
  assert.equal(evidence.signal, "SIGSEGV");
  assert.ok(evidence.excerpt.length <= 8);
  assert.ok(Buffer.byteLength(JSON.stringify(evidence)) < 3000);
  assert.equal(JSON.stringify(evidence).includes("private:password"), false);
  assert.equal(makeValidationEvidence({ revision, command: "build", exitCode: null, timedOut: true, cycle: 0 }).category, "validation_timeout");
});

test("validation evidence normalization strips unknown fields and rejects invalid command names", () => {
  const safe = normalizeValidationEvidence({ command: "lint", outcome: "failed", exitCode: 2, signal: null, timedOut: false, category: "command_failed", excerpt: ["safe diagnostic", "sk-private-secret"], failedTests: [], secret: "must drop" });
  assert.ok(safe);
  assert.equal(JSON.stringify(safe).includes("must drop"), false);
  assert.equal(JSON.stringify(safe).includes("sk-private-secret"), false);
  assert.equal(normalizeValidationEvidence({ command: "rm", outcome: "failed" }), null);
});

test("marketing test failures retain identifiable repo-relative test names", () => {
  const output = "not ok 3 - src/lib/marketing/smart-upload.test.ts > retries bounded failures\n  AssertionError: expected false";
  const result = boundedValidationExcerpt("test", output);
  assert.equal(result.failedTests[0], "src/lib/marketing/smart-upload.test.ts > retries bounded failures");
  assert.deepEqual(result.failedTestFiles, []);
});

test("build failures retain actionable sanitized compiler errors", () => {
  const output = [
    "Next.js 16.2.4",
    "Creating an optimized production build",
    "Failed to compile.",
    "./src/app/page.tsx:12:5",
    "Type error: Property 'missing' does not exist.",
  ].join("\n");
  const result = boundedValidationExcerpt("build", output);
  assert.ok(result.excerpt.some(line => line.includes("Type error:")));
  assert.ok(result.excerpt.some(line => line.includes("Failed to compile")));
  assert.equal(result.excerpt.some(line => line.includes("page.tsx")), true);
});

test("sanitization redacts secrets and absolute paths but keeps src-relative identifiers", () => {
  const label = sanitizeValidationLabel("C:\\Users\\secret\\token sk-proj-abcdefghijklmnopqrstuvwxyz src/lib/engineering/worker.test.ts");
  assert.equal(label.includes("sk-proj"), false);
  assert.equal(label.includes("C:\\Users"), false);
  assert.ok(label.includes("src/lib/engineering/worker.test.ts"));
});

test("oversized validation output stays bounded for ingress", () => {
  const output = `${"not ok 1 - case\n".repeat(200)}Next.js 16.2.4\n${"Type error: x\n".repeat(200)}`;
  const evidence = makeValidationEvidence({ revision, command: "build", exitCode: 1, cycle: 0, output });
  assert.ok(evidence.excerpt.length <= 8);
  assert.ok(evidence.failedTests.length <= 8);
  assert.ok(Buffer.byteLength(JSON.stringify({ ...evidence, revision, cycle: 0 })) < 3000);
});

test("successful validation evidence shape remains compatible", () => {
  const evidence = makeValidationEvidence({ revision, command: "lint", exitCode: 0, cycle: 0, output: "eslint completed" });
  assert.equal(evidence.outcome, "passed");
  assert.equal(evidence.category, null);
  assert.deepEqual(evidence.failedTests, []);
  assert.ok(normalizeValidationEvidence({ ...evidence, revision: undefined, cycle: undefined }));
});

test("excerpt parsing still drops non-actionable build noise", () => {
  const result = boundedValidationExcerpt("build", "Creating an optimized production build\nsource: private body");
  assert.ok(result.excerpt.includes("Creating an optimized production build"));
  assert.equal(result.excerpt.some(line => line.includes("private body")), false);
  assert.deepEqual(result.failedTests, []);
});

test("staging cleanup failure preserves the primary preparation operation and code", () => {
  const primary = new ValidationPreparationError("validation_source_prepare_failed", "source_volume", "docker_populate_workspace");
  const merged = withStagingCleanupFailure(primary);
  assert.equal(merged.code, "validation_source_prepare_failed");
  assert.equal(merged.operation, "docker_populate_workspace");
  assert.equal(merged.stagingCleanupFailed, true);
  assert.equal(withStagingCleanupFailure(merged), merged);
});

test("validation preparation failures expose only allow-listed stage and category metadata", () => {
  for (const code of validationPreparationCodes) {
    const error = new ValidationPreparationError(code, code === "validation_overlay_prepare_failed" ? "next_env_overlay" : code === "validation_image_unavailable" ? "image_check" : code === "validation_dependency_unavailable" ? "dependency_check" : code === "validation_executor_unavailable" ? "docker_preflight" : "source_volume", "docker_populate_workspace");
    assert.equal(error.code, code);
    assert.equal(error.operation, "docker_populate_workspace");
    assert.ok(error.message.includes("Validation environment preparation failed"));
    assert.equal(JSON.stringify(error).includes("private"), false);
  }
});

test("engineering sandbox runner relative imports resolve beside the runner in the repository", async () => {
  const runnerPath = fileURLToPath(new URL("../../../scripts/engineering-sandbox-runner.mjs", import.meta.url));
  const runner = await readFile(runnerPath, "utf8");
  const relativeImports = [...runner.matchAll(/from\s+['"](\.\/[^'"]+)['"]/g)].map(match => match[1]);
  assert.ok(relativeImports.includes("./validation-diagnostic-excerpt.mjs"));
  for (const relativeImport of relativeImports) {
    await access(join(dirname(runnerPath), relativeImport.replace(/^\.\//, "")));
  }
});
