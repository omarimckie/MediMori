export function isOrchestrationSimulationDefault(): boolean {
  const raw = process.env.CENTRAL_AGENT_MANAGER_QUEUE_MODE?.trim();
  if (!raw || raw === "simulation") return true;
  return false;
}

export function isDurableOrchestrationQueueEnabled(): boolean {
  return process.env.CENTRAL_AGENT_MANAGER_DURABLE_QUEUE_ENABLED === "true";
}

export function isOwnerQueueManagementEnabled(): boolean {
  if (!isDurableOrchestrationQueueEnabled()) return false;
  return process.env.CENTRAL_AGENT_MANAGER_QUEUE_MANAGEMENT_ENABLED === "true";
}

/** When false (default), orchestration SQL pool factory never opens a network connection. */
export function isOrchestrationPoolConnectionEnabled(): boolean {
  return process.env.CAM_ORCHESTRATION_POOL_ENABLED === "true";
}

/** Optional durable scheduler claims via SQL tryClaimReadyJob (no worker dispatch). */
export function isDurableSchedulerClaimsEnabled(): boolean {
  if (!isDurableOrchestrationQueueEnabled()) return false;
  return process.env.CENTRAL_AGENT_MANAGER_DURABLE_SCHEDULER_CLAIMS_ENABLED === "true";
}

/** Opt-in internal API for registered specialist agents to claim assignments and report outcomes. */
export function isAgentConsumerEnabled(): boolean {
  return process.env.CENTRAL_AGENT_MANAGER_AGENT_CONSUMER_ENABLED === "true";
}

export function isAgentConsumerOrchestrationResolvable(): boolean {
  if (isOwnerQueueManagementEnabled()) return true;
  return isDurableOrchestrationQueueEnabled();
}

/** Opt-in Cursor Cloud Agents REST bridge (default off; no live API without explicit operator setup). */
export function isCursorBridgeEnabled(): boolean {
  return process.env.CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_ENABLED === "true";
}

/** Owner-only Cursor dispatch recovery API (default off; not for production until explicitly enabled). */
export function isCursorDispatchRecoveryEnabled(): boolean {
  if (!isOwnerQueueManagementEnabled()) return false;
  return process.env.CENTRAL_AGENT_MANAGER_CURSOR_DISPATCH_RECOVERY_ENABLED === "true";
}

/** Standalone supervised Cursor bridge runner process (default off). */
export function isCursorBridgeRunnerEnabled(): boolean {
  return process.env.CENTRAL_AGENT_MANAGER_CURSOR_BRIDGE_RUNNER_ENABLED === "true";
}
