import type { ProjectId, ProjectSourceReport } from "../types";

/** Shared cross-project status contract identifier. */
export const CENTRAL_AGENT_STATUS_CONTRACT_V1 = "central-agent-status/v1" as const;

export const contractV1ReportingStatuses = [
  "live",
  "stale",
  "disconnected",
  "unavailable",
] as const;

export type ContractV1ReportingStatus = (typeof contractV1ReportingStatuses)[number];

export type ParsedContractV1 = {
  contractVersion: typeof CENTRAL_AGENT_STATUS_CONTRACT_V1;
  projectId: ProjectId;
  displayName: string;
  reportingStatus: ContractV1ReportingStatus;
  statusDetail: string;
  lastSuccessfulUpdate: string | null;
  source: ProjectSourceReport;
  activeAgents: import("../types").ActiveAgent[];
  workItems: import("../types").ProjectTaskSummary[];
  pendingApprovals: import("../types").PendingApproval[];
  evidence: import("../types").EvidenceRef[];
};
