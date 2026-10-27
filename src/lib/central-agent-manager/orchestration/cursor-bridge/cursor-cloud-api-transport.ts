import type {
  CursorCloudCreateAgentRequest,
  CursorCloudCreateAgentResult,
  CursorCloudRunSnapshot,
} from "./cursor-bridge-types";

/**
 * Injectable transport for Cursor Cloud Agents API v1.
 * Production implementations call https://api.cursor.com; tests use the fake transport only.
 */
export interface CursorCloudApiTransport {
  createAgentWithInitialRun(request: CursorCloudCreateAgentRequest): Promise<CursorCloudCreateAgentResult>;
  getRun(agentId: string, runId: string): Promise<CursorCloudRunSnapshot>;
}
