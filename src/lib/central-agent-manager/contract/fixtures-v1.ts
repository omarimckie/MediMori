import { CENTRAL_AGENT_STATUS_CONTRACT_V1 } from "./v1";
import type { ProjectId } from "../types";

/** Synthetic contract v1 fixtures for all registered projects (no network). */
export const contractV1Fixtures: Record<ProjectId, Record<string, unknown>> = {
  medimori: {
    contractVersion: CENTRAL_AGENT_STATUS_CONTRACT_V1,
    projectId: "medimori",
    displayName: "MediMori",
    reportingStatus: "disconnected",
    statusDetail: "Engineering control plane not connected in this fixture.",
    lastSuccessfulUpdate: null,
  },
  "twilight-feather": {
    contractVersion: CENTRAL_AGENT_STATUS_CONTRACT_V1,
    projectId: "twilight-feather",
    displayName: "Twilight Feather",
    reportingStatus: "live",
    statusDetail: "Marketing queue snapshot (fixture).",
    lastSuccessfulUpdate: "2026-01-15T12:00:00.000Z",
    lastMeaningfulStateChange: "2026-01-15T11:30:00.000Z",
    milestone: "Weekly content review",
    checklistItem: "Approve caption batch",
    progressPercent: 62,
    activeAgents: [{ id: "agent-planner", label: "Content planner", state: "active" }],
    workItems: [
      {
        id: "work-1",
        title: "Finalize Instagram carousel",
        status: "in_review",
        blockers: [],
      },
    ],
    pendingApprovals: [
      { id: "approval-1", summary: "Review caption batch", requestedAt: "2026-01-15T10:00:00.000Z" },
    ],
    evidence: [{ kind: "marketing", label: "Content queue", href: "/admin/marketing/content" }],
  },
  "real-estate-analyzer": {
    contractVersion: CENTRAL_AGENT_STATUS_CONTRACT_V1,
    projectId: "real-estate-analyzer",
    displayName: "Real Estate Analyzer",
    reportingStatus: "stale",
    statusDetail: "Source reports stale integration heartbeat.",
    lastSuccessfulUpdate: "2026-01-01T00:00:00.000Z",
    workItems: [],
    activeAgents: [],
    pendingApprovals: [],
  },
  "on-the-way": {
    contractVersion: CENTRAL_AGENT_STATUS_CONTRACT_V1,
    projectId: "on-the-way",
    displayName: "On the Way",
    reportingStatus: "unavailable",
    statusDetail: "Status service temporarily unavailable (fixture).",
  },
  "ai-trainer-fitness": {
    contractVersion: CENTRAL_AGENT_STATUS_CONTRACT_V1,
    projectId: "ai-trainer-fitness",
    displayName: "AI Trainer / Fitness App",
    reportingStatus: "live",
    statusDetail: "Training plan sync OK (fixture).",
    lastSuccessfulUpdate: "2026-01-15T08:00:00.000Z",
    activeAgents: [],
    workItems: [
      {
        id: "work-2",
        title: "Rest day reminder pipeline",
        status: "planned",
        blockers: [
          { id: "blocker-1", summary: "Awaiting owner sign-off on copy.", severity: "warning" },
        ],
      },
    ],
    progressPercent: null,
  },
};
