import {
  boundedIsoTimestamp,
  boundedText,
  sanitizeActiveAgents,
  sanitizeBlockers,
  sanitizeEvidence,
  sanitizePendingApprovals,
  sanitizeTasks,
} from "../bounds";
import { isProjectId } from "../registry";
import {
  CENTRAL_AGENT_STATUS_CONTRACT_V1,
  contractV1ReportingStatuses,
  type ContractV1ReportingStatus,
  type ParsedContractV1,
} from "./v1";

const V1_ROOT_KEYS = new Set([
  "contractVersion",
  "projectId",
  "displayName",
  "reportingStatus",
  "statusDetail",
  "lastSuccessfulUpdate",
  "lastMeaningfulStateChange",
  "milestone",
  "checklistItem",
  "progressPercent",
  "activeAgents",
  "workItems",
  "blockers",
  "pendingApprovals",
  "evidence",
]);

function reportingStatus(value: unknown): ContractV1ReportingStatus | null {
  if (typeof value !== "string") return null;
  return (contractV1ReportingStatuses as readonly string[]).includes(value)
    ? (value as ContractV1ReportingStatus)
    : null;
}

function optionalProgressPercent(value: unknown): number | null {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return Math.round(value);
}

function optionalBounded(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  const text = boundedText(value, max);
  return text || null;
}

function workItemsFromContract(
  workItemsRaw: unknown,
  blockersRaw: unknown,
): ParsedContractV1["workItems"] {
  const items = sanitizeTasks(workItemsRaw, 20);
  const blockers = sanitizeBlockers(blockersRaw, 12);
  if (!blockers.length) return items;
  return [
    ...items,
    {
      id: "project-blockers",
      title: "Project-level blockers (source-reported)",
      status: "blocked",
      blockers,
    },
  ];
}

export type ParseContractV1Result =
  | { ok: true; contract: ParsedContractV1 }
  | { ok: false; reason: string };

export function parseContractV1Document(
  raw: unknown,
  expectedProjectId?: string,
): ParseContractV1Result {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "Contract root must be an object." };
  }

  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!V1_ROOT_KEYS.has(key)) {
      return { ok: false, reason: "Contract contains unsupported fields." };
    }
  }

  if (record.contractVersion !== CENTRAL_AGENT_STATUS_CONTRACT_V1) {
    return { ok: false, reason: "Unsupported or missing contract version." };
  }

  const projectIdRaw = record.projectId;
  if (typeof projectIdRaw !== "string" || !isProjectId(projectIdRaw)) {
    return { ok: false, reason: "Unsupported project identifier." };
  }

  if (expectedProjectId && projectIdRaw !== expectedProjectId) {
    return { ok: false, reason: "Project identifier does not match adapter." };
  }

  const displayName = boundedText(record.displayName, 120);
  if (!displayName) {
    return { ok: false, reason: "Display name is required." };
  }

  const reporting = reportingStatus(record.reportingStatus);
  if (!reporting) {
    return { ok: false, reason: "Reporting status is invalid." };
  }

  const statusDetail = boundedText(record.statusDetail, 240) || "Source status report.";

  const lastSuccessfulUpdate =
    record.lastSuccessfulUpdate === null || record.lastSuccessfulUpdate === undefined
      ? null
      : boundedIsoTimestamp(record.lastSuccessfulUpdate);
  if (record.lastSuccessfulUpdate !== null && record.lastSuccessfulUpdate !== undefined && !lastSuccessfulUpdate) {
    return { ok: false, reason: "Last successful update timestamp is invalid." };
  }

  return {
    ok: true,
    contract: {
      contractVersion: CENTRAL_AGENT_STATUS_CONTRACT_V1,
      projectId: projectIdRaw,
      displayName,
      reportingStatus: reporting,
      statusDetail,
      lastSuccessfulUpdate,
      source: {
        milestone: optionalBounded(record.milestone, 240),
        checklistItem: optionalBounded(record.checklistItem, 240),
        progressPercent: optionalProgressPercent(record.progressPercent),
        lastMeaningfulStateChange: boundedIsoTimestamp(record.lastMeaningfulStateChange),
      },
      activeAgents: sanitizeActiveAgents(record.activeAgents),
      workItems: workItemsFromContract(record.workItems, record.blockers),
      pendingApprovals: sanitizePendingApprovals(record.pendingApprovals),
      evidence: sanitizeEvidence(record.evidence),
    },
  };
}
