import assert from "node:assert/strict";
import test from "node:test";
import {
  diagnoseQueueSmokeForbiddenFlags,
  queueSmokeOperationalFlagsClean,
} from "./orchestration-operational-guards";

test("queue smoke forbidden flags detect consumer bridge scheduler and cursor key", () => {
  const rows = diagnoseQueueSmokeForbiddenFlags({
    CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED: "true",
    CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED: "true",
    CURSOR_API_KEY: "sk-test",
  });
  assert.equal(rows.length, 3);
  assert.equal(queueSmokeOperationalFlagsClean({}), true);
});
