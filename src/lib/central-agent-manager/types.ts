export const projectIds = [
  "medimori",
  "twilight-feather",
  "real-estate-analyzer",
  "on-the-way",
  "ai-trainer-fitness",
] as const;

export type ProjectId = (typeof projectIds)[number];

export const connectionStates = [
  "connected",
  "disconnected",
  "unavailable",
  "stale",
] as const;

export type ConnectionState = (typeof connectionStates)[number];

export const agentStates = ["idle", "active", "blocked", "unknown"] as const;
export type AgentState = (typeof agentStates)[number];

export type EvidenceRef = {
  kind: string;
  label: string;
  href?: string;
};

export type PendingApproval = {
  id: string;
  summary: string;
  requestedAt?: string;
};

export type TaskBlocker = {
  id: string;
  summary: string;
  severity: "info" | "warning" | "critical";
};

export type ActiveAgent = {
  id: string;
  label: string;
  state: AgentState;
};

export type ProjectTaskSummary = {
  id: string;
  title: string;
  status: string;
  blockers: TaskBlocker[];
};

/** Source-reported optional fields (null = explicitly unknown / not provided). */
export type ProjectSourceReport = {
  milestone: string | null;
  checklistItem: string | null;
  progressPercent: number | null;
  lastMeaningfulStateChange: string | null;
};

/** Read-only snapshot returned by a project adapter. */
export type ProjectAdapterSnapshot = {
  projectId: ProjectId;
  displayName: string;
  connection: ConnectionState;
  connectionDetail: string;
  activeAgents: ActiveAgent[];
  tasks: ProjectTaskSummary[];
  pendingApprovals: PendingApproval[];
  lastSuccessfulUpdate: string | null;
  evidence: EvidenceRef[];
  /** Present when mapped from contract v1; omitted for legacy/disconnected paths. */
  source?: ProjectSourceReport;
};

export type ManagerStatusPayload = {
  generatedAt: string;
  staleAfterMs: number;
  projects: ProjectAdapterSnapshot[];
  retrieval?: "fresh" | "cached";
  cachedAt?: string | null;
  mockDemonstration?: boolean;
  cacheTtlMs?: number | null;
};

/** Wire format accepted from optional remote status endpoints. */
export type RemoteProjectStatusPayload = {
  activeAgents?: unknown;
  tasks?: unknown;
  pendingApprovals?: unknown;
  lastSuccessfulUpdate?: unknown;
  evidence?: unknown;
};

export type ProjectAdapter = {
  projectId: ProjectId;
  displayName: string;
  fetchSnapshot: () => Promise<ProjectAdapterSnapshot>;
};
