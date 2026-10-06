import { test } from "node:test";
import assert from "node:assert/strict";
import { boundedValidationExcerpt, makeValidationEvidence, normalizeValidationEvidence, ValidationPreparationError, validationPreparationCodes } from "./validation-diagnostics";

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

test("excerpt parsing admits only fixed build markers and TAP test names", () => {
  const result = boundedValidationExcerpt("build", "Creating an optimized production build\nsource: private body");
  assert.deepEqual(result.excerpt, ["Creating an optimized production build"]);
  assert.deepEqual(result.failedTests, []);
});

test("validation preparation failures expose only allow-listed stage and category metadata", () => {
  for (const code of validationPreparationCodes) {
    const error = new ValidationPreparationError(code, code === "validation_overlay_prepare_failed" ? "next_env_overlay" : code === "validation_image_unavailable" ? "image_check" : code === "validation_dependency_unavailable" ? "dependency_check" : code === "validation_executor_unavailable" ? "docker_preflight" : "source_volume");
    assert.equal(error.code, code);
    assert.ok(error.message.includes("Validation environment preparation failed"));
    assert.equal(JSON.stringify(error).includes("private"), false);
  }
});
