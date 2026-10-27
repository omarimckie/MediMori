import assert from "node:assert/strict";
import test from "node:test";
import { executeStagingConsumerHttpSequence } from "./cam-consumer-staging-http-executor";

test("staging HTTP executor runs claim through complete with mock fetch", async () => {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/queue/manage")) {
      return new Response(JSON.stringify({ job: { id: "job-staging-5b-consumer-20261026-m1" } }), { status: 200 });
    }
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { action: string; leaseFenceToken?: number };
      if (body.action === "claim") {
        return new Response(
          JSON.stringify({
            assignment: { id: "asgn-1", jobId: "job-staging-5b-consumer-20261026-m1", lease: { fenceToken: 1 } },
          }),
          { status: 200 },
        );
      }
      if (body.action === "heartbeat" && body.leaseFenceToken === 99999) {
        return new Response(JSON.stringify({ error: "stale" }), { status: 409 });
      }
      if (body.action === "heartbeat") {
        return new Response(JSON.stringify({ assignment: { lease: { fenceToken: 1 } } }), { status: 200 });
      }
      if (body.action === "submit_evidence") {
        return new Response(JSON.stringify({ evidenceId: "ev-mock" }), { status: 200 });
      }
      if (body.action === "complete") {
        return new Response(JSON.stringify({ jobState: "completed" }), { status: 200 });
      }
    }
    return new Response(JSON.stringify({ assignments: [] }), { status: 200 });
  };
  const evidence = await executeStagingConsumerHttpSequence({
    baseUrl: "http://127.0.0.1:3000",
    testJobId: "job-staging-5b-consumer-20261026-m1",
    agentId: "agent-staging-5b",
    bearerToken: "token-staging-5b-mock-http-01",
    adminCookie: "tf_admin_session=mock",
    fetchImpl: fetchImpl as typeof fetch,
  });
  assert.equal(evidence.ok, true);
  assert.equal((evidence.phases.staleFence as { status: number }).status, 409);
  assert.ok(calls.some((line) => line.includes("/assignments") && line.startsWith("POST")));
});
