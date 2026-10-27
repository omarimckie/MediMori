import {
  cursorCloudActiveRunStatuses,
  cursorCloudTerminalRunStatuses,
  type CursorCloudCreateAgentResult,
  type CursorCloudRunSnapshot,
  type CursorCloudRunStatus,
} from "./cursor-bridge-types";
import { CursorCloudApiError } from "./cursor-rest-errors";

const ACTIVE = new Set<string>(cursorCloudActiveRunStatuses);
const TERMINAL = new Set<string>(cursorCloudTerminalRunStatuses);

function assertPlainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CursorCloudApiError("Cursor API response is not a JSON object.", {
      phase: "get_run",
      status: null,
    });
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown, field: string, phase: "create" | "get_run"): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128) {
    throw new CursorCloudApiError(`Cursor API response field is invalid: ${field}.`, {
      phase,
      status: null,
    });
  }
  return value.trim();
}

export function parseCreateAgentResponse(body: unknown): CursorCloudCreateAgentResult {
  const root = assertPlainObject(body);
  const agent = root.agent;
  const run = root.run;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
    throw new CursorCloudApiError("Cursor create response is missing agent.", { phase: "create", status: null });
  }
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new CursorCloudApiError("Cursor create response is missing run.", { phase: "create", status: null });
  }
  const agentRecord = agent as Record<string, unknown>;
  const runRecord = run as Record<string, unknown>;
  const agentId = readNonEmptyString(agentRecord.id, "agent.id", "create");
  const runId = readNonEmptyString(runRecord.id, "run.id", "create");
  const runAgentId = readNonEmptyString(runRecord.agentId, "run.agentId", "create");
  if (runAgentId !== agentId) {
    throw new CursorCloudApiError("Cursor create response agent/run ids do not match.", {
      phase: "create",
      status: null,
    });
  }
  return { agentId, runId };
}

function parseRunStatus(value: unknown): CursorCloudRunStatus {
  if (typeof value !== "string" || (!ACTIVE.has(value) && !TERMINAL.has(value))) {
    throw new CursorCloudApiError("Cursor run status is unknown or malformed.", {
      phase: "get_run",
      status: null,
      code: "unknown_run_status",
    });
  }
  return value as CursorCloudRunStatus;
}

export function parseGetRunResponse(body: unknown, agentId: string, runId: string): CursorCloudRunSnapshot {
  const root = assertPlainObject(body);
  const parsedAgentId = readNonEmptyString(root.agentId, "agentId", "get_run");
  const parsedRunId = readNonEmptyString(root.id, "id", "get_run");
  if (parsedAgentId !== agentId || parsedRunId !== runId) {
    throw new CursorCloudApiError("Cursor run response ids do not match the request.", {
      phase: "get_run",
      status: null,
    });
  }
  const status = parseRunStatus(root.status);
  const result = typeof root.result === "string" ? root.result.slice(0, 4_000) : undefined;
  let artifactPath: string | undefined;
  const git = root.git;
  if (git && typeof git === "object" && !Array.isArray(git)) {
    const branches = (git as { branches?: unknown }).branches;
    if (Array.isArray(branches) && branches.length) {
      const first = branches[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        const prUrl = (first as { prUrl?: unknown }).prUrl;
        if (typeof prUrl === "string" && prUrl.startsWith("https://")) {
          artifactPath = prUrl.slice(0, 512);
        }
      }
    }
  }
  return {
    agentId,
    runId,
    status,
    ...(artifactPath ? { artifactPath } : {}),
    ...(result ? { diagnostic: result } : {}),
  };
}

export function parseCursorApiErrorBody(bodyText: string): { code: string | null; message: string | null } {
  try {
    const parsed = JSON.parse(bodyText) as { error?: unknown; message?: unknown; code?: unknown };
    const code =
      typeof parsed.code === "string"
        ? parsed.code
        : typeof parsed.error === "string"
          ? parsed.error
          : null;
    const message =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.error === "string"
          ? parsed.error
          : null;
    return { code, message };
  } catch {
    return { code: null, message: null };
  }
}
