/**
 * Phase 5b staging consumer acceptance orchestrator (default: dry-run).
 * Live Neon writes require owner authorization and CAM_CONSUMER_STAGING_EXECUTE_WRITES=true.
 */
import {
  redactHarnessEvidence,
  resolveHarnessMode,
  runStagingAcceptancePreflight,
} from "../src/lib/central-agent-manager/orchestration/cam-consumer-staging-acceptance-harness";
import { executeStagingConsumerHttpSequence } from "../src/lib/central-agent-manager/orchestration/cam-consumer-staging-http-executor";

async function main(): Promise<void> {
  const mode = resolveHarnessMode(process.env, process.argv);
  const lines = runStagingAcceptancePreflight({ env: process.env, mode });
  const failed = lines.filter((row) => !row.ok);
  for (const row of lines) {
    console.log(JSON.stringify(row));
  }
  if (failed.length) {
    process.exitCode = 1;
    return;
  }
  if (mode === "dry_run") {
    console.log(
      JSON.stringify({
        ok: true,
        code: "dry_run_ready",
        message: "Preflight passed. No HTTP or database I/O performed.",
      }),
    );
    return;
  }
  const testJobId = process.env.CAM_CONSUMER_STAGING_TEST_JOB_ID?.trim();
  const agentId = process.env.CAM_CONSUMER_STAGING_AGENT_ID?.trim();
  const baseUrl = process.env.CAM_CONSUMER_STAGING_BASE_URL?.trim() ?? "http://127.0.0.1:3000";
  const adminCookie = process.env.CAM_CONSUMER_STAGING_ADMIN_COOKIE?.trim();
  const bearerJson = process.env.CENTRAL_AGENT_MANAGER_AGENT_BEARERS_JSON?.trim();
  if (!testJobId || !agentId || !adminCookie || !bearerJson) {
    console.log(
      JSON.stringify({
        ok: false,
        code: "execute_missing_http_inputs",
        message:
          "Set CAM_CONSUMER_STAGING_TEST_JOB_ID, CAM_CONSUMER_STAGING_AGENT_ID, CAM_CONSUMER_STAGING_ADMIN_COOKIE, and bearer JSON before HTTP execute.",
      }),
    );
    process.exitCode = 1;
    return;
  }
  let bearerToken = "";
  try {
    const rows = JSON.parse(bearerJson) as Array<{ agentId: string; token: string }>;
    bearerToken = rows.find((row) => row.agentId === agentId)?.token ?? "";
  } catch {
    bearerToken = "";
  }
  if (!bearerToken) {
    console.log(JSON.stringify({ ok: false, code: "bearer_not_found", message: "Bearer token for agent not found." }));
    process.exitCode = 1;
    return;
  }
  const evidence = await executeStagingConsumerHttpSequence({
    baseUrl,
    testJobId,
    agentId,
    bearerToken,
    adminCookie,
    fetchImpl: fetch,
    jobAlreadyListed: process.env.CAM_CONSUMER_STAGING_JOB_ALREADY_LISTED === "true",
  });
  console.log(JSON.stringify(evidence));
  if (!evidence.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "execute_failed" }));
  process.exitCode = 1;
});
