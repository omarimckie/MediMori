import { normalizeRemoteStatusPayload, type NormalizedRemoteStatusPayload } from "../remote-payload";
import type { ProjectId } from "../types";
import { boundedIsoTimestamp } from "../bounds";
import { connectedSnapshot } from "../stale";
import { parseContractV1Document } from "./v1-parse";
import { contractV1ToAdapterSnapshot } from "./v1-map";
import type { ProjectAdapterSnapshot } from "../types";

export type ParsedStatusDocument =
  | { format: "contract-v1"; snapshot: ProjectAdapterSnapshot }
  | { format: "legacy-remote"; snapshot: ProjectAdapterSnapshot };

export function parseStatusDocumentToSnapshot(
  raw: unknown,
  expectedProjectId: ProjectId,
  displayNameFallback: string,
): ParsedStatusDocument | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;
  if (record.contractVersion !== undefined) {
    const parsed = parseContractV1Document(raw, expectedProjectId);
    if (!parsed.ok) return null;
    return {
      format: "contract-v1",
      snapshot: contractV1ToAdapterSnapshot(parsed.contract, expectedProjectId),
    };
  }

  const legacy = normalizeRemoteStatusPayload(raw);
  if (!legacy) return null;

  const lastSuccessfulUpdate = boundedIsoTimestamp(legacy.lastSuccessfulUpdate);

  return {
    format: "legacy-remote",
    snapshot: connectedSnapshot({
      projectId: expectedProjectId,
      displayName: displayNameFallback,
      connectionDetail: "Remote status endpoint responded successfully (legacy payload).",
      activeAgents: legacy.activeAgents,
      tasks: legacy.tasks,
      pendingApprovals: legacy.pendingApprovals,
      lastSuccessfulUpdate,
      evidence: legacy.evidence,
    }),
  };
}

export function isLegacyNormalizedPayload(
  value: NormalizedRemoteStatusPayload | null,
): value is NormalizedRemoteStatusPayload {
  return value !== null;
}
