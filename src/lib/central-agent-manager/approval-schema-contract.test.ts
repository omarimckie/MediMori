import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSupervisorTask } from "./supervisor/task";
import { approvalPlanDigest, canonicalApprovalJson, canonicalTaskJson, taskPlanFingerprint } from "./supervisor/plan-digest";

const sql = readFileSync(new URL("../../../sql/central-agent-manager-approvals.sql", import.meta.url), "utf8");

test("unapplied SQL reproduces the TypeScript canonical digest fixture", () => {
  const task = createSupervisorTask({
    id: "task-1",
    goalId: "goal-1",
    specialistId: "engineering",
    description: "Prepare the requested work.",
    requestedOperations: ["production_deploy", "merge_main"],
    idempotencyKey: "idem-task",
    planVersion: 3,
    now: "2026-10-21T20:00:00.000Z",
  });
  const taskJson = canonicalTaskJson(task);
  const approvalJson = canonicalApprovalJson({ task, operation: "merge_main", environment: "local" });
  assert.match(sql, new RegExp(`digest-fixture-task: ${escapeRegExp(taskJson)}`));
  assert.match(sql, new RegExp(`digest-fixture-task-sha256: ${taskPlanFingerprint(task)}`));
  assert.match(sql, new RegExp(`digest-fixture-approval: ${escapeRegExp(approvalJson)}`));
  assert.match(sql, new RegExp(`digest-fixture-approval-sha256: ${approvalPlanDigest({
    task,
    operation: "merge_main",
    environment: "local",
  })}`));
  assert.match(sql, /sha256_hex\(central_agent_manager\.canonical_approval_json/);
  assert.match(sql, /operation_not_in_plan/);
  assert.doesNotMatch(sql, /p_plan_digest text/);
});

test("unapplied SQL separates authority from execution and audits privileges", () => {
  assert.match(sql, /CREATE ROLE central_agent_manager_approval_authority/);
  assert.match(sql, /CREATE ROLE central_agent_manager_executor/);
  assert.match(sql, /session_user::text IS DISTINCT FROM 'central_agent_manager_approval_authority'/);
  assert.match(sql, /session_user::text IS DISTINCT FROM 'central_agent_manager_executor'/);
  assert.match(sql, /current_database\(\) IS DISTINCT FROM 'neondb'/);
  assert.match(sql, /neon\.branch_id/);
  assert.match(sql, /authorization_content_is_frozen/);
  assert.match(sql, /approval_replay_revoked/);
  assert.match(sql, /approval_replay_expired/);
  assert.match(sql, /revoked_at IS NULL/);
  assert.match(sql, /expires_at > clock_timestamp\(\)/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES IN SCHEMA central_agent_manager REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/);
  assert.match(sql, /REVOKE central_agent_manager_approval_owner FROM CURRENT_USER/);
  assert.match(sql, /approval_inherited_grant_rejected/);
  assert.match(sql, /aclexplode\(COALESCE\(relation\.relacl, acldefault\('r', relation\.relowner\)\)\)/);
  assert.match(sql, /acl\.grantee = 0/);
  assert.match(sql, /GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA central_agent_manager TO central_agent_manager_approval_owner;/);
  assert.match(sql, /set_config\('cam\.task_state_to', NULL, true\)/);
  const executeGrants = [...sql.matchAll(/^GRANT EXECUTE ON FUNCTION [\s\S]*?;/gm)].map((match) => match[0]);
  const issueGrant = executeGrants.find((grant) => grant.includes("issue_owner_approval"));
  const revokeGrant = executeGrants.find((grant) => grant.includes("revoke_owner_approval"));
  const saveGrant = executeGrants.find((grant) => grant.includes("save_task"));
  const runningGrant = executeGrants.find((grant) => grant.includes("mark_task_running"));
  assert.ok(issueGrant?.includes("central_agent_manager_approval_authority"));
  assert.equal(issueGrant?.includes("central_agent_manager_executor"), false);
  assert.ok(revokeGrant?.includes("central_agent_manager_approval_authority"));
  assert.equal(revokeGrant?.includes("central_agent_manager_executor"), false);
  assert.ok(saveGrant?.includes("central_agent_manager_approval_authority"));
  assert.equal(saveGrant?.includes("central_agent_manager_executor"), false);
  assert.ok(runningGrant?.includes("central_agent_manager_executor"));
  assert.equal(runningGrant?.includes("central_agent_manager_approval_authority"), false);
  assert.match(sql, /^BEGIN;$/m);
  assert.match(sql, /^COMMIT;$/m);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
