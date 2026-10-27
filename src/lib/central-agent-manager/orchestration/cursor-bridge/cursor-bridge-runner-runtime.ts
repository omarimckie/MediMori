import { access } from "node:fs/promises";
import type { AgentConsumerHandlerDeps } from "../../agent-consumer-handler";
import {
  CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV,
  parseAgentBearerCredentialsJson,
} from "../agent-consumer-auth";
import { resolveAgentConsumerBackend, type AgentConsumerBackend } from "../queue-store-factory";
import { CursorBridgeConsumerClient } from "./cursor-bridge-consumer-client";
import { loadBudgetStateFromFile, saveBudgetStateToFile } from "./cursor-bridge-runner-budget-file";
import {
  assertCursorBridgeRunnerMayStart,
  loadCursorBridgeRunnerConfigFromEnv,
  type CursorBridgeRunnerConfig,
} from "./cursor-bridge-runner-config";
import { FileCursorBridgeRunnerLockStore } from "./cursor-bridge-runner-file-lock";
import {
  runCursorBridgeRunner,
  type CursorBridgeRunnerDeps,
  type CursorBridgeRunnerRunResult,
} from "./cursor-bridge-runner";
import { sanitizeRunnerHealthForLog } from "./cursor-bridge-runner-health";
import { CursorBridgeHttpConsumerClient } from "./cursor-bridge-http-consumer-client";
import type { CursorCloudApiTransport } from "./cursor-cloud-api-transport";
import { createCursorRestTransportFromEnv } from "./cursor-rest-factory";
import { loadCursorBridgePollingConfigFromEnv } from "./cursor-rest-config";
import { FakeCursorCloudApiTransport } from "./fake-cursor-cloud-api-transport";

export const CURSOR_BRIDGE_RUNNER_OFFLINE_FAKE_TRANSPORT_ENV =
  "CURSOR_BRIDGE_RUNNER_OFFLINE_FAKE_TRANSPORT";
export const CURSOR_BRIDGE_CONSUMER_BASE_URL_ENV = "CURSOR_BRIDGE_CONSUMER_BASE_URL";

export type CursorBridgeRunnerEnv = Record<string, string | undefined>;

function asProcessEnv(env: CursorBridgeRunnerEnv): NodeJS.ProcessEnv {
  return env as NodeJS.ProcessEnv;
}

export function isRunnerOfflineFakeTransportEnabled(env: CursorBridgeRunnerEnv = process.env): boolean {
  return env[CURSOR_BRIDGE_RUNNER_OFFLINE_FAKE_TRANSPORT_ENV] === "true";
}

function envIsTrue(env: CursorBridgeRunnerEnv, key: string): boolean {
  return env[key] === "true";
}

function agentConsumerOrchestrationResolvableFromEnv(env: CursorBridgeRunnerEnv): boolean {
  if (envIsTrue(env, "CENTRAL_AGENT_MANAGER_QUEUE_MANAGEMENT_ENABLED")) return true;
  return envIsTrue(env, "CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED");
}

export function resolveRunnerAgentBearerToken(
  specialistAgentId: string,
  env: CursorBridgeRunnerEnv = process.env,
): string {
  const raw = env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV]?.trim();
  if (!raw) {
    throw new Error("Agent consumer bearer credentials are not configured.");
  }
  let credentials;
  try {
    credentials = parseAgentBearerCredentialsJson(raw);
  } catch {
    throw new Error("Agent consumer bearer credentials are not configured.");
  }
  if (!credentials.length) {
    throw new Error("Agent consumer bearer credentials are not configured.");
  }
  const match = credentials.find((row) => row.agentId === specialistAgentId);
  if (!match) {
    throw new Error(`No agent consumer bearer credential is configured for agent id ${specialistAgentId}.`);
  }
  return match.token;
}

export function assertCursorBridgeRunnerPrerequisites(env: CursorBridgeRunnerEnv = process.env): void {
  const config = loadCursorBridgeRunnerConfigFromEnv(asProcessEnv(env));
  assertCursorBridgeRunnerMayStart(config);
  if (!envIsTrue(env, "CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED")) {
    throw new Error("Cursor bridge is disabled (CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED).");
  }
  if (!envIsTrue(env, "CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED")) {
    throw new Error("Agent consumer is disabled (CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED).");
  }
  if (!agentConsumerOrchestrationResolvableFromEnv(env)) {
    throw new Error("Orchestration queue is not enabled for agent consumer access.");
  }
  if (!envIsTrue(env, "CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED")) {
    throw new Error("Durable orchestration queue is required for the bridge runner.");
  }
  if (!env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV]?.trim()) {
    throw new Error(`Agent consumer bearer credentials are not configured (${CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV}).`);
  }
  resolveRunnerAgentBearerToken(config.bridgeConfig.specialistAgentId, env);
  if (isRunnerOfflineFakeTransportEnabled(env)) {
    if (readCursorApiKeyFromEnvUnsafe(env)) {
      throw new Error("Offline fake transport mode must not be combined with CURSOR_API_KEY.");
    }
    return;
  }
  const baseUrl = env[CURSOR_BRIDGE_CONSUMER_BASE_URL_ENV]?.trim();
  if (!baseUrl) {
    throw new Error(`${CURSOR_BRIDGE_CONSUMER_BASE_URL_ENV} is required when offline fake transport is disabled.`);
  }
  if (!readCursorApiKeyFromEnvUnsafe(env)) {
    throw new Error("CURSOR_API_KEY is required for live Cursor REST transport.");
  }
}

function readCursorApiKeyFromEnvUnsafe(env: CursorBridgeRunnerEnv): string | null {
  const raw = env.CURSOR_API_KEY?.trim();
  return raw ? raw : null;
}

export function createCursorBridgeRunnerTransport(env: CursorBridgeRunnerEnv = process.env): CursorCloudApiTransport {
  if (isRunnerOfflineFakeTransportEnabled(env)) {
    return new FakeCursorCloudApiTransport();
  }
  const transport = createCursorRestTransportFromEnv(asProcessEnv(env));
  if (!transport) {
    throw new Error("Cursor REST transport could not be created from environment.");
  }
  return transport;
}

async function validateConsumerBackendReachable(
  backend: AgentConsumerBackend,
  offlineFake: boolean,
): Promise<void> {
  await backend.reloadFromSql?.();
  if (!offlineFake) {
    return;
  }
  if (!backend.memory) {
    throw new Error("Consumer backend memory store is unavailable after reload.");
  }
}

function buildInProcessConsumerHandlerDeps(input: {
  backend: AgentConsumerBackend;
  agentId: string;
  bearerToken: string;
  now: () => string;
  env: CursorBridgeRunnerEnv;
}): AgentConsumerHandlerDeps {
  return {
    isCamEnabled: () => true,
    isConsumerEnabled: () => envIsTrue(input.env, "CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED"),
    isBearerConfigured: () => Boolean(input.env[CENTRAL_AGENT_MANAGER_AGENT_BEARERS_ENV]?.trim()),
    orchestrationResolvable: () => agentConsumerOrchestrationResolvableFromEnv(input.env),
    resolveBackend: async () => input.backend,
    now: input.now,
    verifyBearer: (request) => {
      const header = request.headers.get("authorization") ?? "";
      const prefix = "Bearer ";
      if (!header.startsWith(prefix)) return null;
      const provided = header.slice(prefix.length).trim();
      return provided === input.bearerToken ? input.agentId : null;
    },
  };
}

export type CursorBridgeRunnerProcessOverrides = {
  config?: CursorBridgeRunnerConfig;
  transport?: CursorCloudApiTransport;
  backend?: AgentConsumerBackend;
  runnerDeps?: Partial<CursorBridgeRunnerDeps>;
};

export async function runCursorBridgeRunnerProcess(
  env: CursorBridgeRunnerEnv = process.env,
  overrides: CursorBridgeRunnerProcessOverrides = {},
): Promise<CursorBridgeRunnerRunResult> {
  assertCursorBridgeRunnerPrerequisites(env);
  const config = overrides.config ?? loadCursorBridgeRunnerConfigFromEnv(asProcessEnv(env));
  const offlineFake = isRunnerOfflineFakeTransportEnabled(env);
  const transport = overrides.transport ?? createCursorBridgeRunnerTransport(env);
  if (offlineFake && !(transport instanceof FakeCursorCloudApiTransport)) {
    throw new Error("Offline fake transport mode requires FakeCursorCloudApiTransport.");
  }
  if (!offlineFake && transport instanceof FakeCursorCloudApiTransport) {
    throw new Error("Live runner mode cannot use FakeCursorCloudApiTransport.");
  }

  const bearerToken = resolveRunnerAgentBearerToken(config.bridgeConfig.specialistAgentId, env);
  const backend = overrides.backend ?? await resolveAgentConsumerBackend();
  await validateConsumerBackendReachable(backend, offlineFake);
  const store = backend.memory;
  const liveStore = () => backend.memory!;
  const now = overrides.runnerDeps?.now ?? (() => new Date().toISOString());
  const clock = overrides.runnerDeps?.clock ?? (() => new Date(now()));

  const consumer =
    overrides.runnerDeps?.consumer ??
    (offlineFake
      ? new CursorBridgeConsumerClient({
          agentId: config.bridgeConfig.specialistAgentId,
          bearerToken,
          handlerDeps: buildInProcessConsumerHandlerDeps({
            backend,
            agentId: config.bridgeConfig.specialistAgentId,
            bearerToken,
            now,
            env,
          }),
        })
      : new CursorBridgeHttpConsumerClient({
          baseUrl: env[CURSOR_BRIDGE_CONSUMER_BASE_URL_ENV]!.trim(),
          agentId: config.bridgeConfig.specialistAgentId,
          bearerToken,
        }));

  if (!offlineFake && consumer instanceof CursorBridgeHttpConsumerClient) {
    const status = await consumer.probeConsumerReachable();
    if (status < 200 || status >= 500) {
      throw new Error(`CAM consumer HTTP probe failed with status ${status}.`);
    }
  }

  const emergencyStopFilePath = config.emergencyStopFilePath;
  const emergencyStopActive = async (): Promise<boolean> => {
    try {
      await access(emergencyStopFilePath);
      return true;
    } catch {
      return false;
    }
  };

  const lockStore = overrides.runnerDeps?.lockStore ?? new FileCursorBridgeRunnerLockStore();
  const budgetPath = config.budgetStateFilePath;

  return runCursorBridgeRunner({
    config,
    transport,
    store,
    liveStore,
    consumer,
    bearerToken,
    bridgeEnabled: () => envIsTrue(env, "CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED"),
    lockStore,
    polling: overrides.runnerDeps?.polling ?? loadCursorBridgePollingConfigFromEnv(asProcessEnv(env)),
    sleep: overrides.runnerDeps?.sleep,
    now,
    clock,
    pid: overrides.runnerDeps?.pid ?? process.pid,
    emergencyStopActive: overrides.runnerDeps?.emergencyStopActive ?? emergencyStopActive,
    emergencyStopFilePath,
    reloadStore: overrides.runnerDeps?.reloadStore ?? (() => backend.reloadFromSql?.() ?? Promise.resolve()),
    loadBudgetState: overrides.runnerDeps?.loadBudgetState ?? (() => loadBudgetStateFromFile(budgetPath, clock())),
    saveBudgetState:
      overrides.runnerDeps?.saveBudgetState ?? ((state) => saveBudgetStateToFile(budgetPath, state)),
    onHealth:
      overrides.runnerDeps?.onHealth ??
      ((health) => {
        console.log(sanitizeRunnerHealthForLog(health));
      }),
    maxCycles: overrides.runnerDeps?.maxCycles,
    shouldAbort: overrides.runnerDeps?.shouldAbort,
  });
}
