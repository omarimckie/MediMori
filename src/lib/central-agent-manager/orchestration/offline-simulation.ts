import { registeredProjects } from "../registry";
import type { ProjectId } from "../types";
import type { ManagerAgentRecord } from "./contracts-v1";
import { MemoryOrchestrationQueueStore } from "./memory-queue-store";
import { buildOwnerQueueProjection, type OwnerQueueProjection } from "./projections";

const NOW = "2026-10-23T22:00:00.000Z";

function agentForProject(projectId: ProjectId, index: number): ManagerAgentRecord {
  const project = registeredProjects.find((p) => p.id === projectId)!;
  return {
    id: `sim-agent-${projectId}-${index}`,
    label: `${project.displayName} worker ${index + 1}`,
    eligibleProjectIds: [projectId],
    capabilities: ["prepare_plan", "read_content", "run_allowlisted_validation"],
    status: "available",
    maxConcurrentAssignments: 1,
    activeAssignmentIds: [],
    lastObservedAt: NOW,
  };
}

export type OfflineSimulationSnapshot = {
  store: MemoryOrchestrationQueueStore;
  projection: OwnerQueueProjection;
};

/**
 * Offline multi-project queue simulation. Registered projects are sample targets only — not connected.
 */
export function runOfflineMultiProjectSimulation(): OfflineSimulationSnapshot {
  const store = new MemoryOrchestrationQueueStore();
  for (const project of registeredProjects) {
    store.registerAgent(agentForProject(project.id, 0));
  }

  store.enqueueJobSync({
    id: "job-medimori-plan",
    projectId: "medimori",
    goalId: "goal-med-1",
    description: "Prepare engineering rollout plan (simulation)",
    priority: 10,
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "simulation" },
    now: NOW,
  });

  store.enqueueJobSync({
    id: "job-twilight-caption",
    projectId: "twilight-feather",
    goalId: "goal-tf-1",
    description: "Draft caption batch (simulation)",
    priority: 20,
    requiredCapabilities: ["read_content"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "simulation" },
    now: NOW,
  });

  store.enqueueJobSync({
    id: "job-medimori-merge",
    projectId: "medimori",
    goalId: "goal-med-2",
    description: "Merge main protected change (simulation)",
    priority: 30,
    requestedOperation: "merge_main",
    supervisorTaskId: "sup-task-merge-1",
    requiredCapabilities: ["prepare_plan"],
    dependsOnJobIds: ["job-medimori-plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "simulation" },
    now: NOW,
  });

  store.enqueueJobSync({
    id: "job-rea-research",
    projectId: "real-estate-analyzer",
    goalId: "goal-rea-1",
    description: "Research market snapshot (simulation)",
    priority: 15,
    requiredCapabilities: ["run_allowlisted_validation"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "simulation" },
    now: NOW,
  });

  store.enqueueJobSync({
    id: "job-otw-health",
    projectId: "on-the-way",
    goalId: "goal-otw-1",
    description: "Read health metrics (simulation)",
    priority: 25,
    requiredCapabilities: ["read_content"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "simulation" },
    now: NOW,
  });

  store.enqueueJobSync({
    id: "job-fitness-plan",
    projectId: "ai-trainer-fitness",
    goalId: "goal-fit-1",
    description: "Prepare training week plan (simulation)",
    priority: 18,
    requiredCapabilities: ["prepare_plan"],
    provenance: { enqueuedBy: "owner", enqueuedAt: NOW, source: "simulation" },
    now: NOW,
  });

  store.refreshDependencyReadinessSync(NOW);
  store.runSchedulerSync(NOW);

  const projection = buildOwnerQueueProjection({
    jobs: store.listJobsSync(),
    assignments: store.listAssignmentsSync(),
    agents: store.listAgentsSync(),
    now: NOW,
    simulation: true,
  });

  return { store, projection };
}

export function offlineSimulationProjection(): OwnerQueueProjection {
  return runOfflineMultiProjectSimulation().projection;
}
