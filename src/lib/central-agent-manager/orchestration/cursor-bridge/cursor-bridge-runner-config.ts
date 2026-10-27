import { validateCursorBridgeConfig, type CursorBridgeConfig } from "./cursor-bridge-config";

const RUNNER_ID = /^[\w-]{8,80}$/;
const POSITIVE_INT = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

export type CursorBridgeRunnerConfig = {
  enabled: boolean;
  runnerId: string;
  lockFilePath: string;
  emergencyStopFilePath: string;
  budgetStateFilePath: string;
  idleBackoffMinMs: number;
  idleBackoffMaxMs: number;
  dailyCreateBudget: number;
  hourlyCycleLimit: number;
  bridgeConfig: CursorBridgeConfig;
  dispatchOwnerId: string;
};

export function loadCursorBridgeRunnerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CursorBridgeRunnerConfig {
  const enabled = env.CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED === "true";
  const runnerId = env.CURSOR_BRIDGE_RUNNER_ID?.trim() || "cursor-bridge-runner";
  if (!RUNNER_ID.test(runnerId)) {
    throw new Error("CURSOR_BRIDGE_RUNNER_ID is invalid.");
  }
  const lockFilePath =
    env.CURSOR_BRIDGE_RUNNER_LOCK_FILE?.trim() || ".local/cursor-bridge-runner.lock.json";
  const emergencyStopFilePath =
    env.CURSOR_BRIDGE_RUNNER_EMERGENCY_STOP_FILE?.trim() || ".local/cursor-bridge-runner.emergency-stop";
  const budgetStateFilePath =
    env.CURSOR_BRIDGE_RUNNER_BUDGET_FILE?.trim() || ".local/cursor-bridge-runner.budget.json";
  const bridgeConfig = validateCursorBridgeConfig({
    specialistAgentId: env.CURSOR_BRIDGE_SPECIALIST_AGENT_ID?.trim() || runnerId,
    projectTargets: parseProjectTargets(env.CURSOR_BRIDGE_PROJECT_TARGETS_JSON),
    promptTemplate: env.CURSOR_BRIDGE_PROMPT_TEMPLATE?.trim(),
  });
  const dispatchOwnerId = env.CURSOR_BRIDGE_DISPATCH_OWNER_ID?.trim() || `bridge-${runnerId}`.slice(0, 80);
  if (!RUNNER_ID.test(dispatchOwnerId)) {
    throw new Error("CURSOR_BRIDGE_DISPATCH_OWNER_ID is invalid.");
  }
  return {
    enabled,
    runnerId,
    lockFilePath,
    emergencyStopFilePath,
    budgetStateFilePath,
    idleBackoffMinMs: POSITIVE_INT(env.CURSOR_BRIDGE_RUNNER_IDLE_MIN_MS, 2_000, 120_000),
    idleBackoffMaxMs: POSITIVE_INT(env.CURSOR_BRIDGE_RUNNER_IDLE_MAX_MS, 30_000, 600_000),
    dailyCreateBudget: POSITIVE_INT(env.CURSOR_BRIDGE_RUNNER_DAILY_CREATE_BUDGET, 24, 500),
    hourlyCycleLimit: POSITIVE_INT(env.CURSOR_BRIDGE_RUNNER_HOURLY_CYCLE_LIMIT, 60, 5_000),
    bridgeConfig,
    dispatchOwnerId,
  };
}

function parseProjectTargets(raw: string | undefined): CursorBridgeConfig["projectTargets"] {
  if (!raw?.trim()) {
    throw new Error("CURSOR_BRIDGE_PROJECT_TARGETS_JSON is required for the bridge runner.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("CURSOR_BRIDGE_PROJECT_TARGETS_JSON must be valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("CURSOR_BRIDGE_PROJECT_TARGETS_JSON must be a JSON array.");
  }
  return parsed as CursorBridgeConfig["projectTargets"];
}

export function assertCursorBridgeRunnerMayStart(config: CursorBridgeRunnerConfig): void {
  if (!config.enabled) {
    throw new Error("Cursor bridge runner is disabled.");
  }
  if (config.idleBackoffMinMs > config.idleBackoffMaxMs) {
    throw new Error("Cursor bridge runner idle backoff bounds are invalid.");
  }
}
