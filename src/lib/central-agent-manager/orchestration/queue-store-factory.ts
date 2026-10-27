import {
  createDurableOrchestrationQueueStore,
  type DurableOrchestrationQueueStore,
} from "./durable-orchestration-queue-store";
import { createOrchestrationSqlPortFromEnv } from "./orchestration-connection-factory";
import {
  isAgentConsumerOrchestrationResolvable,
  isDurableOrchestrationQueueEnabled,
  isOwnerQueueManagementEnabled,
} from "./flags";
import { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import type { OrchestrationQueuePort } from "./orchestration-queue-port";
import type { OrchestrationSqlPort } from "./orchestration-sql-port";

let sharedDurablePort: DurableOrchestrationQueueStore | null = null;
let sharedSimulationMemory: MemoryOrchestrationQueueStore | null = null;
let orchestrationSqlPortFactory: (() => Promise<OrchestrationSqlPort | null>) | null = null;

export function setOrchestrationSqlPortFactoryForTests(
  factory: (() => Promise<OrchestrationSqlPort | null>) | null,
): void {
  orchestrationSqlPortFactory = factory;
}

export type OrchestrationQueueFactoryDeps = {
  durableEnabled?: () => boolean;
  managementEnabled?: () => boolean;
  createSqlPort?: () => Promise<OrchestrationSqlPort | null>;
};

export function createSimulationOrchestrationQueuePort(): MemoryOrchestrationQueueStore {
  if (!sharedSimulationMemory) {
    sharedSimulationMemory = new MemoryOrchestrationQueueStore();
  }
  return sharedSimulationMemory;
}

export async function resolveManagementOrchestrationQueuePort(
  deps: OrchestrationQueueFactoryDeps = {},
): Promise<OrchestrationQueuePort> {
  const durableEnabled = deps.durableEnabled ?? isDurableOrchestrationQueueEnabled;
  const managementEnabled = deps.managementEnabled ?? isOwnerQueueManagementEnabled;
  if (!managementEnabled()) {
    throw new Error("Queue management is disabled.");
  }
  if (!durableEnabled()) {
    return createSimulationOrchestrationQueuePort();
  }
  if (!sharedDurablePort) {
    const createSqlPort =
      deps.createSqlPort ??
      (async () => {
        if (orchestrationSqlPortFactory) return orchestrationSqlPortFactory();
        return createOrchestrationSqlPortFromEnv();
      });
    const sql = await createSqlPort();
    if (!sql) {
      throw new Error(
        "Durable queue is enabled but no orchestration SQL transport is configured (CAM_ORCHESTRATION_DATABASE_URL or injected test port).",
      );
    }
    sharedDurablePort = await createDurableOrchestrationQueueStore(sql);
  }
  return sharedDurablePort;
}

export function resetOrchestrationQueueFactoryForTests(): void {
  sharedDurablePort = null;
  sharedSimulationMemory = null;
  orchestrationSqlPortFactory = null;
}

async function resolveDurableOrchestrationQueuePortOnly(
  deps: OrchestrationQueueFactoryDeps = {},
): Promise<DurableOrchestrationQueueStore> {
  const durableEnabled = deps.durableEnabled ?? isDurableOrchestrationQueueEnabled;
  if (!durableEnabled()) {
    throw new Error("Durable orchestration queue is disabled.");
  }
  if (!sharedDurablePort) {
    const createSqlPort =
      deps.createSqlPort ??
      (async () => {
        if (orchestrationSqlPortFactory) return orchestrationSqlPortFactory();
        return createOrchestrationSqlPortFromEnv();
      });
    const sql = await createSqlPort();
    if (!sql) {
      throw new Error(
        "Durable queue is enabled but no orchestration SQL transport is configured (CAM_ORCHESTRATION_DATABASE_URL or injected test port).",
      );
    }
    sharedDurablePort = await createDurableOrchestrationQueueStore(sql);
  }
  return sharedDurablePort;
}

export async function resolveAgentConsumerOrchestrationQueuePort(
  deps: OrchestrationQueueFactoryDeps = {},
): Promise<OrchestrationQueuePort> {
  if (!isAgentConsumerOrchestrationResolvable()) {
    throw new Error("Orchestration queue is not enabled for agent consumer access.");
  }
  const managementEnabled = deps.managementEnabled ?? isOwnerQueueManagementEnabled;
  if (managementEnabled()) {
    return resolveManagementOrchestrationQueuePort(deps);
  }
  return resolveDurableOrchestrationQueuePortOnly(deps);
}

export type AgentConsumerBackend = {
  memory: MemoryOrchestrationQueueStore;
  queue: OrchestrationQueuePort;
  /** Durable consumer: reload orchestration state from SQL before each mutation. */
  reloadFromSql?: () => Promise<void>;
  claimNextAssignment?: (
    agentId: string,
    now: string,
    options?: { jobId?: string },
  ) => Promise<import("./contracts-v1").ManagerAssignmentRecord | null>;
  heartbeatAssignment?: (
    agentId: string,
    assignmentId: string,
    fenceToken: number,
    now: string,
    progress?: { diagnostic?: string | null; artifactRef?: string | null },
  ) => Promise<import("./contracts-v1").ManagerAssignmentRecord>;
  persistAssignmentJobMutation?: (
    assignmentId: string,
    fenceToken: number,
    allowedAssignmentStates?: readonly string[],
  ) => Promise<void>;
  afterMutation?: () => Promise<void>;
};

export function createDurableAgentConsumerBackend(
  durableStore: DurableOrchestrationQueueStore,
): AgentConsumerBackend {
  return {
    get memory() {
      return durableStore.getMemoryStore();
    },
    queue: durableStore,
    reloadFromSql: () => durableStore.reloadFromSql(),
    claimNextAssignment: (agentId, now, options) =>
      durableStore.claimNextAssignmentForAgent(agentId, now, options),
    heartbeatAssignment: (agentId, assignmentId, fenceToken, now, progress) =>
      durableStore.heartbeatAssignmentForAgent(agentId, assignmentId, fenceToken, now, progress),
    persistAssignmentJobMutation: (assignmentId, fenceToken, allowedAssignmentStates) =>
      durableStore.persistAssignmentJobMutation(assignmentId, fenceToken, allowedAssignmentStates),
  };
}

export async function resolveAgentConsumerBackend(
  deps: OrchestrationQueueFactoryDeps = {},
): Promise<AgentConsumerBackend> {
  const port = await resolveAgentConsumerOrchestrationQueuePort(deps);
  const durable = port as DurableOrchestrationQueueStore;
  if (typeof durable.getMemoryStore === "function" && typeof durable.persistMutations === "function") {
    return createDurableAgentConsumerBackend(durable as DurableOrchestrationQueueStore);
  }
  const memory = port as MemoryOrchestrationQueueStore;
  return { memory, queue: memory };
}
