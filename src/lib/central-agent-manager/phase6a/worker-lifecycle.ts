import { SupervisorContractError } from "../supervisor/types";
import type { SpecialistTemplateRole } from "./specialist-template-registry";

export const WORKER_LIFECYCLE_CONTRACT_V1 = "cam-worker-lifecycle/v1" as const;

export type WorkerLifecycleState =
  | "provisioned"
  | "ready"
  | "assigned"
  | "running"
  | "reporting"
  | "completed"
  | "blocked"
  | "failed"
  | "retired";

export type WorkerInstanceRecord = {
  contractVersion: typeof WORKER_LIFECYCLE_CONTRACT_V1;
  workerId: string;
  role: SpecialistTemplateRole;
  objectiveId: string;
  taskId: string;
  state: WorkerLifecycleState;
  provisionedAt: string;
  updatedAt: string;
  retryCount: number;
  evidenceIds: string[];
  auditTrail: string[];
  cleanupManifest: string[];
};

export type WorkerLifecycleEvent =
  | { type: "provision"; workerId: string; role: SpecialistTemplateRole; objectiveId: string; taskId: string; now: string }
  | { type: "assign"; workerId: string; now: string }
  | { type: "start"; workerId: string; now: string }
  | { type: "report"; workerId: string; now: string; evidenceId: string }
  | { type: "complete"; workerId: string; now: string }
  | { type: "block"; workerId: string; now: string; reason: string }
  | { type: "fail"; workerId: string; now: string; reason: string }
  | { type: "cancel"; workerId: string; now: string }
  | { type: "retire"; workerId: string; now: string };

const terminal: WorkerLifecycleState[] = ["completed", "failed", "retired"];

export class WorkerLifecycleStore {
  private readonly workers = new Map<string, WorkerInstanceRecord>();
  private readonly provisioned = new Set<string>();

  list(): WorkerInstanceRecord[] {
    return [...this.workers.values()];
  }

  /** Rebuild lifecycle store from persisted worker rows (restart-safe). */
  hydrate(records: readonly WorkerInstanceRecord[]): void {
    for (const record of records) {
      this.workers.set(record.workerId, record);
      this.provisioned.add(record.workerId);
    }
  }

  get(workerId: string): WorkerInstanceRecord | undefined {
    return this.workers.get(workerId);
  }

  apply(event: WorkerLifecycleEvent): WorkerInstanceRecord {
    if (event.type === "provision") {
      if (this.provisioned.has(event.workerId)) {
        const existing = this.workers.get(event.workerId);
        if (existing) return existing;
      }
      const record: WorkerInstanceRecord = {
        contractVersion: WORKER_LIFECYCLE_CONTRACT_V1,
        workerId: event.workerId,
        role: event.role,
        objectiveId: event.objectiveId,
        taskId: event.taskId,
        state: "provisioned",
        provisionedAt: event.now,
        updatedAt: event.now,
        retryCount: 0,
        evidenceIds: [],
        auditTrail: [`provisioned:${event.now}`],
        cleanupManifest: [],
      };
      this.workers.set(event.workerId, record);
      this.provisioned.add(event.workerId);
      return this.transition(record, "ready", event.now, "ready");
    }
    const current = this.workers.get(event.workerId);
    if (!current) throw new SupervisorContractError("Unknown worker instance.");
    if (terminal.includes(current.state) && event.type !== "retire") {
      throw new SupervisorContractError("Worker is terminal.");
    }
    switch (event.type) {
      case "assign":
        return this.transition(current, "assigned", event.now, "assigned");
      case "start":
        return this.transition(current, "running", event.now, "running");
      case "report":
        return {
          ...this.transition(current, "reporting", event.now, "reporting"),
          evidenceIds: [...current.evidenceIds, event.evidenceId],
        };
      case "complete":
        return this.transition(current, "completed", event.now, "completed");
      case "block":
        return this.transition(current, "blocked", event.now, `blocked:${event.reason}`);
      case "fail":
        return {
          ...this.transition(current, "failed", event.now, `failed:${event.reason}`),
          retryCount: current.retryCount + 1,
        };
      case "cancel":
        return this.transition(current, "blocked", event.now, "cancelled");
      case "retire": {
        const retired = this.transition(current, "retired", event.now, "retired");
        retired.cleanupManifest = [`workspace:${current.workerId}`, ...retired.evidenceIds.map((id) => `evidence:${id}`)];
        return retired;
      }
      default:
        throw new SupervisorContractError("Unsupported worker lifecycle event.");
    }
  }

  private transition(
    record: WorkerInstanceRecord,
    state: WorkerLifecycleState,
    now: string,
    audit: string,
  ): WorkerInstanceRecord {
    const next = { ...record, state, updatedAt: now, auditTrail: [...record.auditTrail, audit] };
    this.workers.set(record.workerId, next);
    return next;
  }
}

export function detectStaleWorkers(store: WorkerLifecycleStore, nowMs: number, staleAfterMs: number): string[] {
  return store
    .list()
    .filter((worker) => worker.state === "running" || worker.state === "assigned")
    .filter((worker) => nowMs - Date.parse(worker.updatedAt) > staleAfterMs)
    .map((worker) => worker.workerId);
}
