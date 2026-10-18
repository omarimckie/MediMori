import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import {
  CENTRAL_AGENT_STATUS_BEARER_ENV,
  verifyCentralAgentStatusBearer,
} from "./auth";

describe("central-agent-status bearer auth", () => {
  const prior = process.env[CENTRAL_AGENT_STATUS_BEARER_ENV];

  afterEach(() => {
    if (prior === undefined) delete process.env[CENTRAL_AGENT_STATUS_BEARER_ENV];
    else process.env[CENTRAL_AGENT_STATUS_BEARER_ENV] = prior;
  });

  it("accepts exact bearer token and rejects near misses", () => {
    process.env[CENTRAL_AGENT_STATUS_BEARER_ENV] = "read-token-abc";
    const ok = new Request("https://x.test/", {
      headers: { authorization: "Bearer read-token-abc" },
    });
    assert.equal(verifyCentralAgentStatusBearer(ok), true);

    const wrong = new Request("https://x.test/", {
      headers: { authorization: "Bearer read-token-abd" },
    });
    assert.equal(verifyCentralAgentStatusBearer(wrong), false);

    const missing = new Request("https://x.test/");
    assert.equal(verifyCentralAgentStatusBearer(missing), false);
  });
});
