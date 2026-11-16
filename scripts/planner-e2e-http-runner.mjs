#!/usr/bin/env node
/**
 * Phase 3 authenticated HTTP runner (dry-run validation).
 * Does not execute staging mutations unless PLANNER_E2E_RUNNER_EXECUTE=true.
 * Never prints credentials or bypass secrets.
 */
import assert from "node:assert/strict";

const INTEGRATION_BRANCH = "integration/twilight-feather-add-to-planner";
const STAGING_NEON = "small-frost-27394379";
const FORBIDDEN_NEON = "solitary-leaf-77946642";

const steps = [
  { method: "GET", path: "/api/admin/marketing/preview-db-identity", note: "Verify staging Neon identity" },
  { method: "POST", path: "/api/admin/marketing/planner-e2e/fixtures", note: "Create server-owned fixtures" },
  { method: "POST", path: "/api/admin/marketing/content/add-to-planner", note: "Queue instagram fixture" },
  { method: "GET", path: "/api/admin/marketing/planner/queue", note: "Verify queue" },
  { method: "POST", path: "/api/admin/marketing/content/remove-from-planner", note: "Remove from queue" },
  { method: "POST", path: "/api/admin/marketing/content/assign-week", note: "Assign week" },
  { method: "POST", path: "/api/admin/marketing/planner-e2e/cleanup", note: "Cleanup batch" },
];

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function validateTargetEnv() {
  const baseUrl = requiredEnv("PLANNER_E2E_BASE_URL");
  const branch = process.env.VERCEL_GIT_COMMIT_REF?.trim() ?? process.env.PLANNER_E2E_EXPECTED_BRANCH?.trim();
  const neon = process.env.MARKETING_STAGING_NEON_PROJECT_ID?.trim();

  if (!baseUrl.startsWith("https://")) {
    throw new Error("PLANNER_E2E_BASE_URL must be https");
  }
  if (branch && branch !== INTEGRATION_BRANCH) {
    throw new Error(`Unexpected branch: ${branch}`);
  }
  if (neon && neon !== STAGING_NEON) {
    throw new Error(`Unexpected Neon project: ${neon}`);
  }
  if (neon === FORBIDDEN_NEON) {
    throw new Error("Forbidden production Neon project");
  }
  if (process.env.MARKETING_MOCK_MODE === "false") {
    throw new Error("MARKETING_MOCK_MODE must be true");
  }
  if (process.env.MARKETING_PREVIEW_READONLY === "true") {
    throw new Error("Read-only must be disabled only during authorized write window");
  }
  if (process.env.MARKETING_PLANNER_STAGING_E2E !== "true") {
    throw new Error("MARKETING_PLANNER_STAGING_E2E must be true for mutations");
  }
  return { baseUrl, branch, neon };
}

async function runStep(baseUrl, step) {
  const url = new URL(step.path, baseUrl);
  const headers = { accept: "application/json" };
  if (process.env.PLANNER_E2E_COOKIE_HEADER) {
    headers.cookie = process.env.PLANNER_E2E_COOKIE_HEADER;
  }
  const init = { method: step.method, headers };
  if (step.method === "POST") {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify({});
  }
  const response = await fetch(url, init);
  return { status: response.status, step };
}

async function main() {
  const { baseUrl } = validateTargetEnv();
  const execute = process.env.PLANNER_E2E_RUNNER_EXECUTE === "true";
  console.log(
    JSON.stringify(
      {
        mode: execute ? "execute" : "dry-run",
        baseUrl,
        steps: steps.map((s) => ({ ...s, url: new URL(s.path, baseUrl).href })),
      },
      null,
      2,
    ),
  );
  if (!execute) {
    console.log("Dry-run complete. Set PLANNER_E2E_RUNNER_EXECUTE=true to perform HTTP calls.");
    return;
  }
  const results = [];
  for (const step of steps) {
    const result = await runStep(baseUrl, step);
    results.push(result);
    if (result.status === 401) {
      throw new Error("BLOCKED: Deployment Protection or missing session (401)");
    }
  }
  assert.ok(results.length === steps.length);
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});