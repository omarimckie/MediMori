import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildManagerStatus } from "./consolidate";
import { registeredProjects } from "./registry";

test("local demo payload includes five registered projects disconnected by default", async () => {
  const envKeys = [
    "CENTRAL_AGENT_MANAGER_MEDIMORI_STATUS_URL",
    "CENTRAL_AGENT_MANAGER_TWILIGHT_FEATHER_STATUS_URL",
    "CENTRAL_AGENT_MANAGER_REAL_ESTATE_ANALYZER_STATUS_URL",
    "CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL",
    "CENTRAL_AGENT_MANAGER_AI_TRAINER_FITNESS_STATUS_URL",
    "CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS",
  ] as const;
  const previousEngineering = process.env.ENGINEERING_CONTROL_PLANE_ENABLED;
  const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "false";
  for (const key of envKeys) delete process.env[key];

  try {
    const status = await buildManagerStatus(new Date("2026-01-01T00:00:00.000Z"));
    assert.equal(status.projects.length, 5);
    assert.deepEqual(
      status.projects.map((project) => project.projectId).sort(),
      registeredProjects.map((project) => project.id).sort(),
    );
    assert.ok(status.projects.every((project) => project.connection === "disconnected"));
    assert.ok(
      status.projects.every(
        (project) =>
          project.tasks.length === 0 &&
          project.activeAgents.length === 0 &&
          project.pendingApprovals.length === 0,
      ),
    );
  } finally {
    if (previousEngineering === undefined) delete process.env.ENGINEERING_CONTROL_PLANE_ENABLED;
    else process.env.ENGINEERING_CONTROL_PLANE_ENABLED = previousEngineering;
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("configured remote URL without approved host renders unavailable not connected", async () => {
  const previousUrl = process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL;
  const previousHosts = process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
  process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL =
    "https://example.test/status";
  delete process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
  try {
    const status = await buildManagerStatus();
    const onTheWay = status.projects.find((project) => project.projectId === "on-the-way");
    assert.ok(onTheWay);
    assert.equal(onTheWay.connection, "unavailable");
    assert.equal(onTheWay.tasks.length, 0);
  } finally {
    if (previousUrl === undefined) delete process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL;
    else process.env.CENTRAL_AGENT_MANAGER_ON_THE_WAY_STATUS_URL = previousUrl;
    if (previousHosts === undefined) delete process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS;
    else process.env.CENTRAL_AGENT_MANAGER_APPROVED_STATUS_HOSTS = previousHosts;
  }
});

test("admin shell exposes Agent Manager navigation link", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/admin/AdminShell.tsx"),
    "utf8",
  );
  assert.match(source, /href="\/admin\/central-agent-manager"/);
  assert.match(source, /Agent Manager/);
});
