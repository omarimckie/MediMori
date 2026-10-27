import assert from "node:assert/strict";
import test from "node:test";
import { centralAgentManagerStatusResponse } from "./status-handler";

const samplePayload = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  staleAfterMs: 60_000,
  projects: [],
};

test("status handler returns 401 when unauthenticated", async () => {
  const response = await centralAgentManagerStatusResponse({
    isEnabled: () => true,
    isOwnerConfigured: () => true,
    getUsername: async () => null,
    isOwner: () => true,
    buildStatus: async () => samplePayload,
    refresh: false,
  });
  assert.equal(response.status, 401);
});

test("status handler returns 403 for authenticated non-owner", async () => {
  const response = await centralAgentManagerStatusResponse({
    isEnabled: () => true,
    isOwnerConfigured: () => true,
    getUsername: async () => "dale",
    isOwner: (username) => username === "omari",
    buildStatus: async () => samplePayload,
    refresh: false,
  });
  assert.equal(response.status, 403);
  const body = (await response.json()) as { error?: string };
  assert.match(body.error ?? "", /Forbidden/i);
});

test("status handler returns 503 when feature disabled", async () => {
  const response = await centralAgentManagerStatusResponse({
    isEnabled: () => false,
    isOwnerConfigured: () => true,
    getUsername: async () => "omari",
    isOwner: () => true,
    buildStatus: async () => samplePayload,
    refresh: false,
  });
  assert.equal(response.status, 503);
});

test("status handler returns 503 when owner allowlist is missing", async () => {
  const response = await centralAgentManagerStatusResponse({
    isEnabled: () => true,
    isOwnerConfigured: () => false,
    getUsername: async () => "omari",
    isOwner: () => true,
    buildStatus: async () => samplePayload,
    refresh: false,
  });
  assert.equal(response.status, 503);
});

test("status handler passes refresh flag to buildStatus", async () => {
  let refresh = false;
  const response = await centralAgentManagerStatusResponse({
    isEnabled: () => true,
    isOwnerConfigured: () => true,
    getUsername: async () => "omari",
    isOwner: () => true,
    refresh: true,
    buildStatus: async (context) => {
      refresh = context.refresh;
      return samplePayload;
    },
  });
  assert.equal(response.status, 200);
  assert.equal(refresh, true);
});

test("status handler scrubs nested task and blocker secrets", async () => {
  const response = await centralAgentManagerStatusResponse({
    isEnabled: () => true,
    isOwnerConfigured: () => true,
    getUsername: async () => "omari",
    isOwner: () => true,
    refresh: false,
    buildStatus: async () => ({
      generatedAt: "2026-01-01T00:00:00.000Z",
      staleAfterMs: 60_000,
      projects: [
        {
          projectId: "medimori",
          displayName: "MediMori",
          connection: "connected",
          connectionDetail: "ok",
          activeAgents: [],
          tasks: [
            {
              id: "task-1",
              title: "postgresql://user:pass@host/db",
              status: "planned",
              blockers: [
                {
                  id: "blocker-1",
                  summary: "Bearer nested.secret.value",
                  severity: "warning",
                },
              ],
            },
          ],
          pendingApprovals: [],
          lastSuccessfulUpdate: "2026-01-01T00:00:00.000Z",
          evidence: [
            {
              kind: "note",
              label: "whsec_abcdefghijklmnopqrst",
              href: "/admin/engineering",
            },
          ],
        },
      ],
    }),
  });
  const bodyText = JSON.stringify(await response.json());
  assert.equal(bodyText.includes("postgresql://"), false);
  assert.equal(bodyText.includes("nested.secret"), false);
  assert.equal(bodyText.includes("whsec_"), false);
  assert.match(bodyText, /\[redacted\]/);
});

test("status handler scrubs secrets from successful payload", async () => {
  const response = await centralAgentManagerStatusResponse({
    isEnabled: () => true,
    isOwnerConfigured: () => true,
    getUsername: async () => "omari",
    isOwner: () => true,
    refresh: false,
    buildStatus: async () => ({
      generatedAt: "2026-01-01T00:00:00.000Z",
      staleAfterMs: 60_000,
      projects: [
        {
          projectId: "medimori",
          displayName: "MediMori",
          connection: "connected",
          connectionDetail: "Bearer secret-token",
          activeAgents: [],
          tasks: [
            {
              id: "task-1",
              title: "postgresql://user:pass@host/db",
              status: "planned",
              blockers: [],
            },
          ],
          pendingApprovals: [],
          lastSuccessfulUpdate: "2026-01-01T00:00:00.000Z",
          evidence: [],
        },
      ],
    }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    projects: Array<{ connectionDetail: string; tasks: Array<{ title: string }> }>;
  };
  assert.match(body.projects[0]?.connectionDetail ?? "", /\[redacted\]/);
  assert.match(body.projects[0]?.tasks[0]?.title ?? "", /\[redacted\]/);
  assert.equal(JSON.stringify(body).includes("secret-token"), false);
});
