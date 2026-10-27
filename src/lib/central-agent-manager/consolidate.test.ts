import assert from "node:assert/strict";
import test from "node:test";
import { buildManagerStatus } from "./consolidate";
import { applyStaleConnection, disconnectedSnapshot } from "./stale";

test("disconnected projects expose no live task payload", () => {
  const snapshot = disconnectedSnapshot("on-the-way", "On the Way", "Not configured.");
  assert.equal(snapshot.connection, "disconnected");
  assert.deepEqual(snapshot.tasks, []);
  assert.deepEqual(snapshot.activeAgents, []);
  assert.deepEqual(snapshot.pendingApprovals, []);
});

test("stale connection is applied to aged connected snapshots", () => {
  const aged = applyStaleConnection(
    {
      projectId: "medimori",
      displayName: "MediMori",
      connection: "connected",
      connectionDetail: "ok",
      activeAgents: [],
      tasks: [{ id: "task-1", title: "Example", status: "planned", blockers: [] }],
      pendingApprovals: [],
      lastSuccessfulUpdate: "2020-01-01T00:00:00.000Z",
      evidence: [],
    },
    Date.parse("2026-01-01T00:00:00.000Z"),
    60_000,
  );
  assert.equal(aged.connection, "stale");
});

test("buildManagerStatus returns five projects with explicit connection states", async () => {
  const previousEnabled = process.env.CENTRAL_AGENT_MANAGER_ENABLED;
  const previousEngineering = process.env.ENGINEERING_CONTROL_PLANE_ENABLED;
  delete process.env.CENTRAL_AGENT_MANAGER_MEDIMORI_STATUS_URL;
  delete process.env.CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL;
  delete process.env.CENTRAL_AGENT_MANAGER_REAL_ESTATE_ANALYZER_STATUS_URL;
  delete process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL;
  delete process.env.CENTRAL_AGENT_MANAGER_AI_TRAINER_FITNESS_STATUS_URL;
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "false";
  try {
    const status = await buildManagerStatus(new Date("2026-01-01T00:00:00.000Z"));
    assert.equal(status.projects.length, 5);
    for (const project of status.projects) {
      assert.ok(
        project.connection === "disconnected" ||
          project.connection === "unavailable" ||
          project.connection === "stale" ||
          project.connection === "connected",
      );
      if (project.connection === "disconnected") {
        assert.equal(project.tasks.length, 0);
        assert.equal(project.activeAgents.length, 0);
      }
    }
  } finally {
    if (previousEngineering === undefined) delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED;
    else process.env.ENGINEERING_CONTROL_PLANE_ENABLED = previousEngineering;
    if (previousEnabled === undefined) delete process.env.CENTRAL_AGENT_MANAGER_ENABLED;
    else process.env.CENTRAL_AGENT_MANAGER_ENABLED = previousEnabled;
  }
});
