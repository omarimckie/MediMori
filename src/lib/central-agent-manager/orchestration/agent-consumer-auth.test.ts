import assert from "node:assert/strict";
import test from "node:test";
import {
  CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV,
  isAgentConsumerBearerConfigured,
  loadAgentBearerCredentials,
  parseAgentBearerCredentialsJson,
  resetAgentBearerCacheForTests,
  verifyAgentConsumerBearer,
} from "./agent-consumer-auth";

test("parseAgentBearerCredentialsJson rejects malformed entries", () => {
  assert.throws(() => parseAgentBearerCredentialsJson("{}"), /array/);
  assert.throws(() => parseAgentBearerCredentialsJson('[{"agentId":"a"}]'), /token/);
});

test("verifyAgentConsumerBearer returns null without Bearer prefix", () => {
  resetAgentBearerCacheForTests();
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([
    { agentId: "agent-a", token: "token-agent-a-12345678" },
  ]);
  assert.equal(
    verifyAgentConsumerBearer(new Request("http://local", { headers: { authorization: "token-agent-a-12345678" } })),
    null,
  );
  assert.equal(
    verifyAgentConsumerBearer(new Request("http://local", { headers: { authorization: "Bearer wrong-token-12345678" } })),
    null,
  );
  assert.equal(
    verifyAgentConsumerBearer(
      new Request("http://local", { headers: { authorization: "Bearer token-agent-a-12345678" } }),
    ),
    "agent-a",
  );
  delete process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV];
  resetAgentBearerCacheForTests();
});

test("bearer credential cache refreshes after env rotation", () => {
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([
    { agentId: "agent-a", token: "token-agent-a-12345678" },
  ]);
  resetAgentBearerCacheForTests();
  assert.equal(loadAgentBearerCredentials()?.length, 1);
  process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV] = JSON.stringify([
    { agentId: "agent-b", token: "token-agent-b-12345678" },
  ]);
  assert.equal(loadAgentBearerCredentials()?.[0]?.agentId, "agent-a");
  resetAgentBearerCacheForTests();
  assert.equal(loadAgentBearerCredentials()?.[0]?.agentId, "agent-b");
  delete process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV];
  resetAgentBearerCacheForTests();
});

test("consumer bearer defaults to unconfigured", () => {
  delete process.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV];
  resetAgentBearerCacheForTests();
  assert.equal(isAgentConsumerBearerConfigured(), false);
});
