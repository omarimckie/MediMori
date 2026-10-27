import assert from "node:assert/strict";
import test from "node:test";
import { MAX_REMOTE_JSON_BYTES, parseBoundedRemoteJson } from "../remote-payload";
import { registeredProjects } from "../registry";
import { applyStaleConnection } from "../stale";
import { contractV1Fixtures } from "./fixtures-v1";
import { parseStatusDocumentToSnapshot } from "./parse-status-document";
import { CENTRAL_AGENT_STATUS_CONTRACT_V1 } from "./v1";
import { contractV1ToAdapterSnapshot } from "./v1-map";
import { parseContractV1Document } from "./v1-parse";

test("contract v1 fixtures parse and normalize for all registered projects", () => {
  for (const project of registeredProjects) {
    const parsed = parseContractV1Document(contractV1Fixtures[project.id], project.id);
    assert.equal(parsed.ok, true, project.id);
    if (!parsed.ok) continue;
    const snapshot = contractV1ToAdapterSnapshot(parsed.contract, project.id);
    assert.equal(snapshot.projectId, project.id);
    assert.equal(snapshot.displayName, parsed.contract.displayName);
  }
});

test("contract v1 rejects unsupported version", () => {
  const result = parseContractV1Document({
    contractVersion: "central-agent-status/v2",
    projectId: "medimori",
    displayName: "MediMori",
    reportingStatus: "live",
  });
  assert.equal(result.ok, false);
});

test("contract v1 rejects malformed and unsupported project identifiers", () => {
  assert.equal(parseContractV1Document(null).ok, false);
  assert.equal(
    parseContractV1Document({
      contractVersion: CENTRAL_AGENT_STATUS_CONTRACT_V1,
      projectId: "unknown-project",
      displayName: "X",
      reportingStatus: "live",
    }).ok,
    false,
  );
  assert.equal(
    parseContractV1Document(
      {
        contractVersion: CENTRAL_AGENT_STATUS_CONTRACT_V1,
        projectId: "medimori",
        displayName: "MediMori",
        reportingStatus: "live",
        unexpected: true,
      },
      "medimori",
    ).ok,
    false,
  );
});

test("contract v1 rejects project identifier mismatch", () => {
  const parsed = parseContractV1Document(contractV1Fixtures["twilight-feather"], "medimori");
  assert.equal(parsed.ok, false);
});

test("oversized payloads are rejected before contract parsing", () => {
  const oversized = `{"contractVersion":"central-agent-status/v1","pad":"${"x".repeat(MAX_REMOTE_JSON_BYTES)}"}`;
  assert.ok(oversized.length > MAX_REMOTE_JSON_BYTES);
  assert.equal(parseBoundedRemoteJson(oversized), null);
});

test("disconnected contract never exposes live task or agent collections", () => {
  const parsed = parseContractV1Document(
    {
      ...contractV1Fixtures.medimori,
      activeAgents: [{ id: "ghost", label: "Should not appear", state: "active" }],
      workItems: [{ id: "ghost-task", title: "Hidden", status: "planned", blockers: [] }],
    },
    "medimori",
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const snapshot = contractV1ToAdapterSnapshot(parsed.contract, "medimori");
  assert.equal(snapshot.connection, "disconnected");
  assert.equal(snapshot.tasks.length, 0);
  assert.equal(snapshot.activeAgents.length, 0);
  assert.equal(snapshot.pendingApprovals.length, 0);
});

test("source-reported progress is preserved while unknown progress stays null", () => {
  const withProgress = parseContractV1Document(contractV1Fixtures["twilight-feather"], "twilight-feather");
  const withoutProgress = parseContractV1Document(
    contractV1Fixtures["ai-trainer-fitness"],
    "ai-trainer-fitness",
  );
  assert.equal(withProgress.ok, true);
  assert.equal(withoutProgress.ok, true);
  if (!withProgress.ok || !withoutProgress.ok) return;
  const live = contractV1ToAdapterSnapshot(withProgress.contract, "twilight-feather");
  const unknownProgress = contractV1ToAdapterSnapshot(
    withoutProgress.contract,
    "ai-trainer-fitness",
  );
  assert.equal(live.source?.progressPercent, 62);
  assert.equal(unknownProgress.source?.progressPercent, null);
});

test("stale reporting maps to stale connection and applies manager stale threshold", () => {
  const parsed = parseContractV1Document(
    contractV1Fixtures["real-estate-analyzer"],
    "real-estate-analyzer",
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const snapshot = contractV1ToAdapterSnapshot(parsed.contract, "real-estate-analyzer");
  assert.equal(snapshot.connection, "stale");
  const afterManager = applyStaleConnection(snapshot, Date.parse("2026-06-01T00:00:00.000Z"), 60_000);
  assert.equal(afterManager.connection, "stale");
});

test("parseStatusDocumentToSnapshot supports legacy remote payloads", () => {
  const legacy = parseStatusDocumentToSnapshot(
    {
      tasks: [{ id: "task-1", title: "Legacy task", status: "planned", blockers: [] }],
      lastSuccessfulUpdate: "2026-01-01T00:00:00.000Z",
    },
    "on-the-way",
    "On the Way",
  );
  assert.ok(legacy);
  assert.equal(legacy.format, "legacy-remote");
  assert.equal(legacy.snapshot.connection, "connected");
  assert.equal(legacy.snapshot.tasks.length, 1);
});

test("nested evidence is sanitized in contract v1 documents", () => {
  const parsed = parseContractV1Document(
    {
      contractVersion: CENTRAL_AGENT_STATUS_CONTRACT_V1,
      projectId: "twilight-feather",
      displayName: "Twilight Feather",
      reportingStatus: "live",
      evidence: [
        { kind: "report", label: "Weekly summary", href: "/admin/marketing/report" },
        { kind: "bad", label: "External", href: "https://evil.example/report" },
      ],
    },
    "twilight-feather",
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.contract.evidence.length, 2);
  assert.equal(parsed.contract.evidence[0]?.href, "/admin/marketing/report");
  assert.equal(parsed.contract.evidence[1]?.href, undefined);
});

test("empty agent task and approval collections are allowed", () => {
  const parsed = parseContractV1Document(
    {
      contractVersion: CENTRAL_AGENT_STATUS_CONTRACT_V1,
      projectId: "ai-trainer-fitness",
      displayName: "AI Trainer / Fitness App",
      reportingStatus: "live",
      lastSuccessfulUpdate: "2026-01-15T08:00:00.000Z",
      activeAgents: [],
      workItems: [],
      pendingApprovals: [],
    },
    "ai-trainer-fitness",
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const snapshot = contractV1ToAdapterSnapshot(parsed.contract, "ai-trainer-fitness");
  assert.equal(snapshot.activeAgents.length, 0);
  assert.equal(snapshot.tasks.length, 0);
  assert.equal(snapshot.pendingApprovals.length, 0);
});
