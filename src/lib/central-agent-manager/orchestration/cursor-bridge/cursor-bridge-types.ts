export const CURSOR_BRIDGE_CONTRACT_V1 = "central-agent-manager-cursor-bridge/v1" as const;

export const cursorCloudTerminalRunStatuses = [
  "FINISHED",
  "ERROR",
  "CANCELLED",
  "EXPIRED",
] as const;

export type CursorCloudTerminalRunStatus = (typeof cursorCloudTerminalRunStatuses)[number];

export const cursorCloudActiveRunStatuses = [
  "CREATING",
  "RUNNING",
  "WAITING_FOR_BACKGROUND_WORK",
] as const;

export type CursorCloudRunStatus =
  | (typeof cursorCloudActiveRunStatuses)[number]
  | CursorCloudTerminalRunStatus;

export type CursorCloudCreateAgentRequest = {
  promptText: string;
  repoUrl: string;
  startingRef?: string;
  correlationKey?: string;
};

export type CursorCloudCreateAgentResult = {
  agentId: string;
  runId: string;
};

export type CursorCloudRunSnapshot = {
  agentId: string;
  runId: string;
  status: CursorCloudRunStatus;
  artifactPath?: string;
  diagnostic?: string;
};

export type CursorBridgeRunResult = {
  contractVersion: typeof CURSOR_BRIDGE_CONTRACT_V1;
  agentId: string;
  assignmentId: string;
  jobId: string;
  cursorAgentId: string;
  cursorRunId: string;
  evidenceIds: readonly string[];
  jobState: string;
  /** True when this cycle invoked Cursor create (not poll-only resume). */
  externalCreatePerformed?: boolean;
};
