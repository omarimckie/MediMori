import assert from "node:assert/strict";
import test from "node:test";
import { buildManagerStatus } from "../consolidate";
import { registeredProjects } from "../registry";
import {
  runMockContractConformance,
  runMockHttpAdapterConformance,
} from "./conformance-harness";

test("mock contract conformance covers all five registered projects", () => {
  const report = runMockContractConformance();
  assert.equal(report.projects.length, 5);
  assert.equal(report.allPassed, true);
  for (const project of registeredProjects) {
    const entry = report.projects.find((item) => item.projectId === project.id);
    assert.ok(entry?.parseOk, project.id);
  }
});

test("mock HTTP adapter conformance uses injected transport only", async () => {
  const result = await runMockHttpAdapterConformance("twilight-feather");
  assert.equal(result.ok, true);
  assert.equal(result.connection, "connected");
});

test("mock satellite adapters replace production adapters when enabled", async () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
  process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES = "true";
  process.env.ENGINEERING_CONTROL_PLANE_ENABLED = "false";
  try {
    const status = await buildManagerStatus(new Date("2026-01-15T12:30:00.000Z"));
    assert.equal(status.projects.length, 5);
    const twilight = status.projects.find((p) => p.projectId === "twilight-feather");
    assert.ok(twilight?.source?.progressPercent === 62);
    assert.ok(twilight?.connection === "connected" || twilight?.connection === "stale");
  } finally {
    if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES;
    else process.env.CENTRAL_AGENT_MANAGER_MOCK_SATELLITES = previous;
  }
});
