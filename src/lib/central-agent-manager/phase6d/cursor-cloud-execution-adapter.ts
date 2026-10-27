import type { CursorCloudApiTransport } from "../orchestration/cursor-bridge/cursor-cloud-api-transport";
import {
  type CursorExecutionAdapterConfig,
  type CursorExecutionAdapterPort,
  type CursorExecutionIdentity,
  type CursorExecutionProgress,
  resolveCursorExecutionAdapterConfig,
} from "../phase6a/cursor-execution-adapter";

export type CursorCloudExecutionAdapterDeps = {
  transport: CursorCloudApiTransport;
  env?: Record<string, string | undefined>;
};

/**
 * Real cloud adapter implementation (no live calls unless explicitly armed).
 * Requires CAM_CURSOR_EXECUTION_ADAPTER_ENABLED=true AND CAM_CURSOR_REAL_ADAPTER_ARMED=true.
 */
export class CursorCloudExecutionAdapter implements CursorExecutionAdapterPort {
  readonly config: CursorExecutionAdapterConfig;
  private readonly transport: CursorCloudApiTransport;
  private readonly armed: boolean;
  private readonly cancelled = new Set<string>();
  private accumulatedCostUsd = 0;

  constructor(deps: CursorCloudExecutionAdapterDeps) {
    this.transport = deps.transport;
    const env = deps.env ?? process.env;
    const base = resolveCursorExecutionAdapterConfig(env);
    const mode = env.CAM_CURSOR_EXECUTION_ADAPTER_MODE ?? "fake_transport";
    const armed =
      env.CAM_CURSOR_EXECUTION_ADAPTER_ENABLED === "true" &&
      env.CAM_CURSOR_REAL_ADAPTER_ARMED === "true" &&
      mode === "cloud_api";
    this.armed = armed;
    this.config = this.armed
      ? { ...base, enabled: true, mode: "cloud_api", maxCostUsd: Number(env.CAM_CURSOR_EXECUTION_MAX_COST_USD ?? "1") }
      : { ...base, enabled: false, mode: "disabled" };
  }

  private assertArmed(): void {
    if (!this.armed) {
      throw new Error("Cursor cloud execution adapter is not armed.");
    }
  }

  async createRun(input: {
    promptText: string;
    repoUrl: string;
    correlationKey?: string;
  }): Promise<CursorExecutionIdentity> {
    this.assertArmed();
    if (this.accumulatedCostUsd >= this.config.maxCostUsd) {
      throw new Error("Cursor execution budget exhausted.");
    }
    const created = await this.transport.createAgentWithInitialRun({
      promptText: input.promptText,
      repoUrl: input.repoUrl,
      correlationKey: input.correlationKey,
    });
    this.accumulatedCostUsd += 0.01;
    return { cursorAgentId: created.agentId, cursorRunId: created.runId, correlationKey: input.correlationKey };
  }

  async pollRun(identity: CursorExecutionIdentity): Promise<CursorExecutionProgress> {
    this.assertArmed();
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
    this.assertArmed();
    if (identity.cursorRunId) this.cancelled.add(identity.cursorRunId);
    void reason;
  }
}

export function createCursorExecutionAdapterFromEnv(
  transport: CursorCloudApiTransport,
  env: Record<string, string | undefined> = process.env,
): CursorExecutionAdapterPort {
  const adapter = new CursorCloudExecutionAdapter({ transport, env });
  if (!adapter.config.enabled) {
    return adapter;
  }
  return adapter;
}
