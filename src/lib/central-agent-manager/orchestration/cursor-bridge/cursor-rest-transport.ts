import type { CursorCloudApiTransport } from "./cursor-cloud-api-transport";
import type {
  CursorCloudCreateAgentRequest,
  CursorCloudCreateAgentResult,
  CursorCloudRunSnapshot,
} from "./cursor-bridge-types";
import type { CursorRestTransportConfig } from "./cursor-rest-config";
import { CursorCloudApiError } from "./cursor-rest-errors";
import {
  cursorRestHttpRequest,
  mapCursorHttpStatusToError,
  type CursorRestHttpFetcher,
} from "./cursor-rest-http";
import { parseCreateAgentResponse, parseGetRunResponse } from "./cursor-rest-parse";

export type CursorRestTransportDeps = {
  config: CursorRestTransportConfig;
  fetchImpl: CursorRestHttpFetcher;
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function computeReadBackoffMs(attempt: number, config: CursorRestTransportConfig, retryAfterMs: number | null): number {
  if (retryAfterMs !== null && retryAfterMs > 0) return retryAfterMs;
  const exponential = Math.min(config.readRetryBaseMs * 2 ** attempt, config.readRetryMaxMs);
  return exponential;
}

function buildCreateAgentBody(request: CursorCloudCreateAgentRequest): Record<string, unknown> {
  const repo: Record<string, unknown> = { url: request.repoUrl };
  if (request.startingRef?.trim()) {
    repo.startingRef = request.startingRef.trim();
  }
  return {
    prompt: { text: request.promptText.slice(0, 8_000) },
    repos: [repo],
  };
}

export class CursorRestCloudApiTransport implements CursorCloudApiTransport {
  private readonly config: CursorRestTransportConfig;
  private readonly fetchImpl: CursorRestHttpFetcher;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: CursorRestTransportDeps) {
    this.config = deps.config;
    this.fetchImpl = deps.fetchImpl;
    this.sleep = deps.sleep ?? defaultSleep;
  }

  async createAgentWithInitialRun(request: CursorCloudCreateAgentRequest): Promise<CursorCloudCreateAgentResult> {
    const url = `${this.config.baseUrl}/v1/agents`;
    const http = await cursorRestHttpRequest({
      fetchImpl: this.fetchImpl,
      url,
      method: "POST",
      apiKey: this.config.apiKey,
      timeoutMs: this.config.requestTimeoutMs,
      maxResponseBytes: this.config.maxResponseBytes,
      phase: "create",
      body: buildCreateAgentBody(request),
    });
    if (http.status < 200 || http.status >= 300) {
      throw mapCursorHttpStatusToError({
        phase: "create",
        status: http.status,
        bodyText: http.bodyText,
        retryAfterMs: http.retryAfterMs,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(http.bodyText);
    } catch {
      throw new CursorCloudApiError("Cursor create response was not valid JSON.", {
        phase: "create",
        status: http.status,
        ambiguousCreateOutcome: true,
      });
    }
    return parseCreateAgentResponse(parsed);
  }

  async getRun(agentId: string, runId: string): Promise<CursorCloudRunSnapshot> {
    let attempt = 0;
    while (true) {
      try {
        return await this.getRunOnce(agentId, runId);
      } catch (error) {
        if (
          error instanceof CursorCloudApiError &&
          error.phase === "get_run" &&
          error.retryable &&
          attempt < this.config.maxReadRetries
        ) {
          const delayMs = computeReadBackoffMs(attempt, this.config, error.retryAfterMs);
          await this.sleep(delayMs);
          attempt += 1;
          continue;
        }
        throw error;
      }
    }
  }

  private async getRunOnce(agentId: string, runId: string): Promise<CursorCloudRunSnapshot> {
    const url = `${this.config.baseUrl}/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`;
    const http = await cursorRestHttpRequest({
      fetchImpl: this.fetchImpl,
      url,
      method: "GET",
      apiKey: this.config.apiKey,
      timeoutMs: this.config.requestTimeoutMs,
      maxResponseBytes: this.config.maxResponseBytes,
      phase: "get_run",
    });
    if (http.status < 200 || http.status >= 300) {
      throw mapCursorHttpStatusToError({
        phase: "get_run",
        status: http.status,
        bodyText: http.bodyText,
        retryAfterMs: http.retryAfterMs,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(http.bodyText);
    } catch {
      throw new CursorCloudApiError("Cursor run response was not valid JSON.", {
        phase: "get_run",
        status: http.status,
        retryable: false,
      });
    }
    return parseGetRunResponse(parsed, agentId, runId);
  }
}

export function createCursorRestCloudApiTransport(deps: CursorRestTransportDeps): CursorRestCloudApiTransport {
  return new CursorRestCloudApiTransport(deps);
}
