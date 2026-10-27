import type { CursorCloudApiTransport } from "../orchestration/cursor-bridge/cursor-cloud-api-transport";

export const CURSOR_EXECUTION_ADAPTER_CONTRACT_V1 = "cam-cursor-execution-adapter/v1" as const;

export type CursorExecutionAdapterConfig = {
  enabled: boolean;
  mode: "disabled" | "fake_transport" | "local_sdk" | "cloud_api";
  workspaceOwner: string;
  maxCostUsd: number;
  cancellationGraceMs: number;
};

export type CursorExecutionIdentity = {
  cursorAgentId?: string;
  cursorRunId?: string;
  correlationKey?: string;
};

export type CursorExecutionProgress = {
  status: "queued" | "running" | "finished" | "cancelled" | "failed";
  diagnostic?: string;
  artifactPath?: string;
};

export type CursorExecutionAdapterPort = {
  readonly config: CursorExecutionAdapterConfig;
  createRun(input: {
    promptText: string;
    repoUrl: string;
    correlationKey?: string;
  }): Promise<CursorExecutionIdentity>;
  pollRun(identity: CursorExecutionIdentity): Promise<CursorExecutionProgress>;
  cancelRun(identity: CursorExecutionIdentity, reason: string): Promise<void>;
};

export function resolveCursorExecutionAdapterConfig(
  env: Record<string, string | undefined>,
): CursorExecutionAdapterConfig {
  const enabled = env.CAM_CURSOR_EXECUTION_ADAPTER_ENABLED === "true";
  const mode = enabled ? (env.CAM_CURSOR_EXECUTION_ADAPTER_MODE ?? "fake_transport") : "disabled";
  if (mode === "cloud_api" || mode === "local_sdk") {
    return {
      enabled: false,
      mode: "disabled",
      workspaceOwner: "cam-runner",
      maxCostUsd: 0,
      cancellationGraceMs: 5_000,
    };
  }
  return {
    enabled,
    mode: enabled ? "fake_transport" : "disabled",
    workspaceOwner: env.CAM_CURSOR_WORKSPACE_OWNER ?? "cam-runner",
    maxCostUsd: Number(env.CAM_CURSOR_EXECUTION_MAX_COST_USD ?? "0"),
    cancellationGraceMs: 5_000,
  };
}

export class DisabledCursorExecutionAdapter implements CursorExecutionAdapterPort {
  readonly config: CursorExecutionAdapterConfig = {
    enabled: false,
    mode: "disabled",
    workspaceOwner: "cam-runner",
    maxCostUsd: 0,
    cancellationGraceMs: 5_000,
  };

  async createRun(_input: {
    promptText: string;
    repoUrl: string;
    correlationKey?: string;
  }): Promise<CursorExecutionIdentity> {
    throw new Error("Cursor execution adapter is disabled.");
  }

  async pollRun(_identity: CursorExecutionIdentity): Promise<CursorExecutionProgress> {
    throw new Error("Cursor execution adapter is disabled.");
  }

  async cancelRun(_identity: CursorExecutionIdentity, _reason: string): Promise<void> {
    throw new Error("Cursor execution adapter is disabled.");
  }
}

export class FakeTransportCursorExecutionAdapter implements CursorExecutionAdapterPort {
  readonly config: CursorExecutionAdapterConfig;
  private readonly transport: CursorCloudApiTransport;
  private cancelled = new Set<string>();

  constructor(transport: CursorCloudApiTransport, config?: Partial<CursorExecutionAdapterConfig>) {
    this.transport = transport;
    this.config = {
      enabled: true,
      mode: "fake_transport",
      workspaceOwner: config?.workspaceOwner ?? "cam-runner",
      maxCostUsd: config?.maxCostUsd ?? 1,
      cancellationGraceMs: config?.cancellationGraceMs ?? 5_000,
    };
  }

  async createRun(input: {
    promptText: string;
    repoUrl: string;
    correlationKey?: string;
  }): Promise<CursorExecutionIdentity> {
    const created = await this.transport.createAgentWithInitialRun({
      promptText: input.promptText,
      repoUrl: input.repoUrl,
      correlationKey: input.correlationKey,
    });
    return { cursorAgentId: created.agentId, cursorRunId: created.runId, correlationKey: input.correlationKey };
  }

  async pollRun(identity: CursorExecutionIdentity): Promise<CursorExecutionProgress> {
    if (!identity.cursorAgentId || !identity.cursorRunId) {
      return { status: "failed", diagnostic: "missing_identity" };
    }
    if (this.cancelled.has(identity.cursorRunId)) {
      return { status: "cancelled", diagnostic: "cancelled_by_manager" };
    }
    const snapshot = await this.transport.getRun(identity.cursorAgentId, identity.cursorRunId);
    if (snapshot.status === "FINISHED") {
      return { status: "finished", diagnostic: snapshot.diagnostic, artifactPath: snapshot.artifactPath };
    }
    if (snapshot.status === "ERROR" || snapshot.status === "CANCELLED" || snapshot.status === "EXPIRED") {
      return { status: "failed", diagnostic: snapshot.diagnostic };
    }
    return { status: "running", diagnostic: snapshot.diagnostic };
  }

  async cancelRun(identity: CursorExecutionIdentity, reason: string): Promise<void> {
    if (identity.cursorRunId) this.cancelled.add(identity.cursorRunId);
    void reason;
  }
}

/**
 * Integration contract for a future real Cursor worker (Phase 6b: see docs/central-agent-manager/phase6b-cursor-first-live-criteria.md):
 * - Adapter must remain disabled unless CAM_CURSOR_EXECUTION_ADAPTER_ENABLED=true.
 * - Runner owns workspace path; specialist template must not request shell/network tools.
 * - Budget reserved before createRun; evidence artifact path required before completion.
 * - Cancellation must not mark CAM assignment completed.
 * - Identity (agentId/runId) must be correlated via existing consumer correlate_external action.
 */
