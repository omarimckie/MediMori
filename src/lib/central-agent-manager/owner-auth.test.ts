import assert from "node:assert/strict";
import test from "node:test";
import {
  centralAgentManagerOwnerUsernames,
  isCentralAgentManagerEnabled,
  isCentralAgentManagerOwner,
  isCentralAgentManagerOwnerConfigured,
} from "./owner-auth";

test("owner auth fails closed when allowlist is unset", () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;
  delete process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;
  try {
    assert.deepEqual(centralAgentManagerOwnerUsernames(), []);
    assert.equal(isCentralAgentManagerOwnerConfigured(), false);
    assert.equal(isCentralAgentManagerOwner("Omari"), false);
    assert.equal(isCentralAgentManagerOwner("dale"), false);
  } finally {
    if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;
    else process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES = previous;
  }
});

test("owner auth parses comma-separated usernames", () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;
  process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES = "omari, Dale";
  try {
    assert.equal(isCentralAgentManagerOwnerConfigured(), true);
    assert.equal(isCentralAgentManagerOwner("dale"), true);
    assert.equal(isCentralAgentManagerOwner("omari"), true);
  } finally {
    if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;
    else process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES = previous;
  }
});

test("manager enabled gate requires explicit true", () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_ENABLED;
  delete process.env.CENTRAL_AGENT_MANAGER_ENABLED;
  assert.equal(isCentralAgentManagerEnabled(), false);
  process.env.CENTRAL_AGENT_MANAGER_ENABLED = "true";
  assert.equal(isCentralAgentManagerEnabled(), true);
  if (previous === undefined) delete process.env.CENTRAL_AGENT_MANAGER_ENABLED;
  else process.env.CENTRAL_AGENT_MANAGER_ENABLED = previous;
});
