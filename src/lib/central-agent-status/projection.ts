import type {
  EngineeringStatus,
  StatusExecutionAttempt,
  StatusTask,
} from "./types";

export const CENTRAL_AGENT_STATUS_CONTRACT_V1 = "central-agent-status/v1" as const;
export const CENTRAL_AGENT_STATUS_MAX_BYTES = 256 * 1024;
export const CENTRAL_AGENT_STATUS_STALE_MS = 15 * 60 * 1000;

const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function boundedText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return "";
  return trimmed;
}

function parseIso(value: unknown): string | null {
  const text = boundedText(value, 40);
  if (!text) return null;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

const STATUS_MILESTONE: Partial<Record<EngineeringStatus, string>> = {
  intake: "Engineering lifecycle: intake",
  analyzing: "Engineering lifecycle: analysis",
  planned: "Engineering lifecycle: planning",
  awaiting_approval: "Engineering lifecycle: plan approval",
  implementing: "Engineering lifecycle: implementation",
  validating: "Engineering lifecycle: validation",
  repairing: "Engineering lifecycle: repair",
  reviewing: "Engineering lifecycle: review",
  awaiting_merge: "Engineering lifecycle: merge review",
  merging: "Engineering lifecycle: merge execution",
  completed: "Engineering lifecycle: completed",
  blocked: "Engineering lifecycle: blocked",
  cancelled: "Engineering lifecycle: cancelled",
  escalated: "Engineering lifecycle: escalated",
};

export type CentralAgentStatusDocument = {
  contractVersion: typeof CENTRAL_AGENT_STATUS_CONTRACT_V1;
  projectId: "medimori";
  displayName: "MediMori";
  reportingStatus: "live" | "stale" | "disconnected" | "unavailable";
  statusDetail: string;
  lastSuccessfulUpdate: string | null;
  lastMeaningfulStateChange: string | null;
  milestone: string | null;
  checklistItem: string | null;
  progressPercent: null;
  activeAgents: Array<{ id: string; label: string; state: "active" }>;
  workItems: Array<{
    id: string;
    title: string;
    status: string;
    blockers: Array<{ id: string; summary: string; severity: "warning" | "critical" }>;
  }>;
  blockers: Array<{ id: string; summary: string; severity: "warning" | "critical" }>;
  pendingApprovals: Array<{ id: string; summary: string; requestedAt?: string }>;
  evidence: Array<{ kind: string; label: string; href: string }>;
};

function workItemTitle(task: StatusTask): string {
  const summary = task.plan?.summary?.trim();
  if (summary) return summary.length <= 400 ? summary : `${summary.slice(0, 397)}...`;
  return `Engineering task ${task.id.slice(0, 8)}`;
}

function latestMeaningfulStateChange(tasks: StatusTask[]): string | null {
  let latest: number | null = null;
  for (const task of tasks) {
    const updated = parseIso(task.updated_at);
    if (updated) latest = Math.max(latest ?? 0, Date.parse(updated));
    for (const attempt of task.attempts ?? []) {
      for (const candidate of [attempt.finishedAt, attempt.startedAt]) {
        const iso = parseIso(candidate);
        if (iso) latest = Math.max(latest ?? 0, Date.parse(iso));
      }
    }
  }
  return latest ? new Date(latest).toISOString() : null;
}

function dominantMilestone(tasks: StatusTask[]): string | null {
  for (const task of tasks.slice(0, 20)) {
    const label = STATUS_MILESTONE[task.status];
    if (label) return label;
  }
  return null;
}

function checklistItemForTasks(tasks: StatusTask[]): string | null {
  const awaitingApproval = tasks.find((task) => task.status === "awaiting_approval");
  if (awaitingApproval) return "Review engineering plan approval.";
  const awaitingMerge = tasks.find(
    (task) =>
      task.status === "awaiting_merge" &&
      task.mergeReview?.approvalStatus === "not_requested",
  );
  if (awaitingMerge) return "Record merge decision for successful attempt.";
  return null;
}

export function buildDisconnectedCentralAgentStatus(
  detail = "Engineering control plane is disabled.",
): CentralAgentStatusDocument {
  return {
    contractVersion: CENTRAL_AGENT_STATUS_CONTRACT_V1,
    projectId: "medimori",
    displayName: "MediMori",
    reportingStatus: "disconnected",
    statusDetail: detail.slice(0, 240),
    lastSuccessfulUpdate: null,
    lastMeaningfulStateChange: null,
    milestone: null,
    checklistItem: null,
    progressPercent: null,
    activeAgents: [],
    workItems: [],
    blockers: [],
    pendingApprovals: [],
    evidence: [],
  };
}

function isActivelyRunningWorkerAttempt(attempt: StatusExecutionAttempt): boolean {
  if (attempt.finishedAt) return false;
  if (attempt.disposition !== "active") return false;
  if (attempt.workerEnabled === true) {
    return attempt.workerLeaseActive === true;
  }
  return false;
}

export function buildCentralAgentStatusFromTasks(
  tasks: StatusTask[],
  now = new Date(),
): CentralAgentStatusDocument {
  const lastMeaningfulStateChange = latestMeaningfulStateChange(tasks);
  const lastSuccessfulUpdate = now.toISOString();
  const activityAgeMs = lastMeaningfulStateChange
    ? now.getTime() - Date.parse(lastMeaningfulStateChange)
    : null;
  const reportingStatus =
    activityAgeMs === null
      ? ("live" as const)
      : activityAgeMs > CENTRAL_AGENT_STATUS_STALE_MS
        ? ("stale" as const)
        : ("live" as const);

  const activeAgents = tasks.flatMap((task) =>
    (task.attempts ?? [])
      .filter((attempt) => isActivelyRunningWorkerAttempt(attempt))
      .slice(0, 12)
      .flatMap((attempt) => {
        const id = boundedText(attempt.id, 64);
        if (!id || !uuid.test(id)) return [];
        return [
          {
            id,
            label: `Worker run ${attempt.attemptNumber} in progress`,
            state: "active" as const,
          },
        ];
      }),
  );

  const workItems = tasks.slice(0, 20).map((task) => {
    const id = boundedText(task.id, 64);
    const blockers =
      task.status === "blocked" || task.status === "escalated"
        ? [
            {
              id: task.id,
              summary: `Task status is ${task.status}.`,
              severity: "critical" as const,
            },
          ]
        : [];
    return {
      id: id || task.id.slice(0, 36),
      title: workItemTitle(task),
      status: task.status,
      blockers,
    };
  });

  const blockers = tasks
    .filter((task) => task.status === "blocked" || task.status === "escalated")
    .slice(0, 12)
    .map((task) => ({
      id: task.id,
      summary: `Task ${task.id.slice(0, 8)} is ${task.status}.`,
      severity: "critical" as const,
    }));

  const pendingApprovals = tasks
    .filter(
      (task) =>
        task.status === "awaiting_approval" ||
        (task.status === "awaiting_merge" &&
          task.mergeReview?.approvalStatus === "not_requested"),
    )
    .slice(0, 12)
    .map((task) => {
      const requestedAt = parseIso(task.updated_at) ?? undefined;
      return {
        id: task.id,
        summary:
          task.status === "awaiting_approval"
            ? "Human plan approval required."
            : "Merge decision required.",
        ...(requestedAt ? { requestedAt } : {}),
      };
    });

  return {
    contractVersion: CENTRAL_AGENT_STATUS_CONTRACT_V1,
    projectId: "medimori",
    displayName: "MediMori",
    reportingStatus,
    statusDetail: "Read-only engineering control-plane projection.",
    lastSuccessfulUpdate,
    lastMeaningfulStateChange,
    milestone: dominantMilestone(tasks),
    checklistItem: checklistItemForTasks(tasks),
    progressPercent: null,
    activeAgents: activeAgents.slice(0, 12),
    workItems,
    blockers,
    pendingApprovals,
    evidence: [
      {
        kind: "engineering",
        label: "Engineering admin (human session required)",
        href: "/admin/engineering",
      },
    ],
  };
}

export function serializeCentralAgentStatusDocument(
  document: CentralAgentStatusDocument,
): { ok: true; body: string } | { ok: false; reason: string } {
  const body = JSON.stringify(document);
  if (body.length > CENTRAL_AGENT_STATUS_MAX_BYTES) {
    return { ok: false, reason: "Status payload exceeds size limit." };
  }
  return { ok: true, body };
}
