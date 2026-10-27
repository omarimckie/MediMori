import assert from "node:assert/strict";
import test from "node:test";
import { isProjectId, registeredProjects } from "./registry";

test("registry includes exactly five projects", () => {
  assert.equal(registeredProjects.length, 5);
  const ids = registeredProjects.map((project) => project.id);
  assert.deepEqual(ids.sort(), [
    "ai-trainer-fitness",
    "medimori",
    "on-the-way",
    "real-estate-analyzer",
    "twilight-feather",
  ]);
});

test("isProjectId rejects unknown ids", () => {
  assert.ok(isProjectId("medimori"));
  assert.ok(!isProjectId("unknown-project"));
});
