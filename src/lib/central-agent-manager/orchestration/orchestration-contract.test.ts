import assert from "node:assert/strict";
import test from "node:test";
import { buildManagerStatus } from "../consolidate";
import { contractV1Fixtures } from "../contract/fixtures-v1";
import { parseContractV1Document } from "../contract/v1-parse";
import { contractV1ToAdapterSnapshot } from "../contract/v1-map";
import { registeredProjects } from "../registry";
import { applyStaleConnection, disconnectedSnapshot } from "../stale";

test("orchestration: manager status never fabricates progress for disconnected projects", async () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
  delete process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
  try {
    const status = await buildManagerStatus(new Date("2026-01-20T12:00:00.000Z"));
    assert.equal(status.projects.length, 5);
    for (const project of status.projects) {
      if (project.connection === "disconnected" || project.connection === "unavailable") {
        assert.equal(project.tasks.length, 0);
        assert.equal(project.activeAgents.length, 0);
        assert.equal(project.pendingApprovals.length, 0);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
    else process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES = previous;
  }
});

test("orchestration: stale reporting is manager-owned, not source live", () => {
  const parsed = parseContractV1Document(contractV1Fixtures.medimori, "medimori");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const fresh = contractV1ToAdapterSnapshot(parsed.contract, "medimori");
  const aged = applyStaleConnection(
    {
      ...fresh,
      connection: "connected",
      lastSuccessfulUpdate: "2020-01-01T00:00:00.000Z",
    },
    Date.parse("2026-01-20T12:00:00.000Z"),
    60_000,
  );
  assert.equal(aged.connection, "stale");
  assert.notEqual(fresh.connection, "stale");
});

test("orchestration: unknown project identifiers are rejected at contract boundary", () => {
  assert.equal(
    parseContractV1Document({
      contractVersion: "central-agent-status/v1",
      projectId: "not-in-registry",
      displayName: "X",
      reportingStatus: "live",
    }).ok,
    false,
  );
});

test("orchestration: duplicate task ids across projects remain namespaced by project", () => {
  const taskOwner = new Map<string, string>();
  for (const project of registeredProjects) {
    const parsed = parseContractV1Document(contractV1Fixtures[project.id], project.id);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) continue;
    const snapshot = contractV1ToAdapterSnapshot(parsed.contract, project.id);
    assert.equal(snapshot.projectId, project.id);
    for (const task of snapshot.tasks) {
      const owner = taskOwner.get(task.id);
      if (owner) {
        assert.fail(`task id ${task.id} appears in both ${owner} and ${project.id}`);
      }
      taskOwner.set(task.id, project.id);
    }
  }
});

test("orchestration: failed satellite response yields explicit disconnected snapshot", () => {
  const snapshot = disconnectedSnapshot(
    "medimori",
    "MediMori",
    "Satellite status endpoint did not respond.",
  );
  assert.equal(snapshot.connection, "disconnected");
  assert.equal(snapshot.tasks.length, 0);
  assert.match(snapshot.connectionDetail ?? "", /respond/i);
});

test("orchestration: missing evidence in contract does not invent validation", () => {
  const parsed = parseContractV1Document(
    {
      ...contractV1Fixtures.medimori,
      evidence: [],
    },
    "medimori",
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const snapshot = contractV1ToAdapterSnapshot(parsed.contract, "medimori");
  assert.equal(snapshot.evidence.length, 0);
});
