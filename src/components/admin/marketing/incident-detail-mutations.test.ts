import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createIncidentMutationGate,
  runIncidentResolveMutation,
  runIncidentTransitionMutation,
  validateResolutionSummaryInput,
} from "./incident-detail-mutations";

describe("incident detail mutations", () => {
  it("mutation gate blocks overlapping enters", () => {
    const gate = createIncidentMutationGate();
    assert.equal(gate.tryEnter(), true);
    assert.equal(gate.tryEnter(), false);
    gate.exit();
    assert.equal(gate.tryEnter(), true);
    gate.exit();
  });

  it("rejects whitespace-only resolution summary without fetch", async () => {
    assert.equal(validateResolutionSummaryInput("   "), "Enter a short resolution summary.");
    let fetchCalls = 0;
    const outcome = await runIncidentResolveMutation({
      incidentId: "id-1",
      resolutionType: "owner_resolved",
      resolutionSummary: "  \n  ",
      incidentVersion: 1,
      fetchFn: async () => {
        fetchCalls += 1;
        return new Response("{}");
      },
      reload: async () => {},
    });
    assert.equal(fetchCalls, 0);
    assert.equal(outcome.success, false);
    assert.match(outcome.userMessage ?? "", /summary/i);
  });

  it("409 transition performs exactly one POST and one reload, no retry", async () => {
    let posts = 0;
    let reloads = 0;
    const outcome = await runIncidentTransitionMutation({
      incidentId: "id-1",
      targetStatus: "investigating",
      incidentVersion: 3,
      fetchFn: async () => {
        posts += 1;
        return new Response(JSON.stringify({ error: "conflict" }), { status: 409 });
      },
      reload: async () => {
        reloads += 1;
      },
    });
    assert.equal(posts, 1);
    assert.equal(reloads, 1);
    assert.equal(outcome.conflict, true);
    assert.match(outcome.userMessage ?? "", /updated elsewhere/i);
  });

  it("409 resolve performs exactly one POST and one reload", async () => {
    let posts = 0;
    let reloads = 0;
    const outcome = await runIncidentResolveMutation({
      incidentId: "id-1",
      resolutionType: "false_positive",
      resolutionSummary: "Noise",
      incidentVersion: 2,
      fetchFn: async () => {
        posts += 1;
        return new Response(JSON.stringify({ error: "conflict" }), { status: 409 });
      },
      reload: async () => {
        reloads += 1;
      },
    });
    assert.equal(posts, 1);
    assert.equal(reloads, 1);
    assert.equal(outcome.conflict, true);
    assert.equal(outcome.closeResolvePanel, true);
  });

  it("successful transition uses transition endpoint only", async () => {
    let url = "";
    const outcome = await runIncidentTransitionMutation({
      incidentId: "abc",
      targetStatus: "blocked",
      incidentVersion: 1,
      fetchFn: async (input, init) => {
        url = String(input);
        assert.equal(init?.method, "POST");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.equal(body.status, "blocked");
        assert.equal(body.incidentVersion, 1);
        assert.doesNotMatch(url, /\/resolve$/);
        return new Response(JSON.stringify({ incident: { id: "abc" } }), { status: 200 });
      },
      reload: async () => {},
    });
    assert.match(url, /\/transition$/);
    assert.equal(outcome.success, true);
  });

  it("successful resolve uses resolve endpoint only", async () => {
    let url = "";
    const outcome = await runIncidentResolveMutation({
      incidentId: "abc",
      resolutionType: "owner_resolved",
      resolutionSummary: "Done",
      incidentVersion: 4,
      fetchFn: async (input) => {
        url = String(input);
        return new Response(JSON.stringify({ incident: { id: "abc" } }), { status: 200 });
      },
      reload: async () => {},
    });
    assert.match(url, /\/resolve$/);
    assert.equal(outcome.success, true);
    assert.equal(outcome.closeResolvePanel, true);
  });
});
