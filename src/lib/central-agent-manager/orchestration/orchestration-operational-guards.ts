/**
 * Offline operational guards for Phase 5 queue smoke and accidental activation.
 */

export type OperationalGuardDiagnostic = {
  ok: boolean;
  code: string;
  message: string;
};

const QUEUE_SMOKE_FORBIDDEN_TRUE_FLAGS = [
  "CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED",
  "CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED",
  "CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED",
  "CENTRAL_AGENT_MANAGER_DURABLE_SCHEDULER_CLAIMS_ENABLED",
] as const;

export function diagnoseQueueSmokeForbiddenFlags(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): OperationalGuardDiagnostic[] {
  const diagnostics: OperationalGuardDiagnostic[] = [];
  for (const key of QUEUE_SMOKE_FORBIDDEN_TRUE_FLAGS) {
    if (env[key] === "true") {
      diagnostics.push({
        ok: false,
        code: "forbidden_flag_enabled",
        message: `${key} must not be true during Phase 5a-2B owner queue smoke.`,
      });
    }
  }
  if (env.CURSOR_API_KEY?.trim()) {
    diagnostics.push({
      ok: false,
      code: "cursor_api_key_set",
      message: "CURSOR_API_KEY must be unset during Phase 5a-2B owner queue smoke.",
    });
  }
  return diagnostics;
}

export function queueSmokeOperationalFlagsClean(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): boolean {
  return diagnoseQueueSmokeForbiddenFlags(env).length === 0;
}
