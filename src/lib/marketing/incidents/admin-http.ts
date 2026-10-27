import {
  IllegalIncidentTransitionError,
} from "./lifecycle";
import {
  IncidentVersionConflictError,
  resolveIncident,
  transitionIncidentStatus,
} from "./record";
import { createPostgresIncidentRepository } from "./postgres-repository";
import type { MarketingIncidentStatus } from "./types";
import {
  IncidentValidationError,
  parseIncidentStatus,
  parseResolutionType,
} from "./validate";

export class IncidentResolveRequiresDedicatedEndpointError extends IncidentValidationError {
  constructor() {
    super(
      "Use POST .../resolve to close an incident. Transitions cannot set status to resolved.",
    );
    this.name = "IncidentResolveRequiresDedicatedEndpointError";
  }
}

export function incidentHttpError(error: unknown): { status: number; message: string } | null {
  if (error instanceof IncidentVersionConflictError) {
    return { status: 409, message: "Incident version conflict; refresh and retry." };
  }
  if (error instanceof IllegalIncidentTransitionError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof IncidentValidationError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof Error && error.message === "Incident not found.") {
    return { status: 404, message: error.message };
  }
  return null;
}

export async function adminTransitionIncident(input: {
  incidentId: string;
  status: string;
  incidentVersion: number;
  actor: string;
}) {
  const toStatus = parseIncidentStatus(input.status) as MarketingIncidentStatus;
  if (toStatus === "resolved") {
    throw new IncidentResolveRequiresDedicatedEndpointError();
  }
  const repo = createPostgresIncidentRepository();
  return transitionIncidentStatus(
    repo,
    input.incidentId,
    toStatus,
    input.actor,
    input.incidentVersion,
  );
}

export async function adminResolveIncident(input: {
  incidentId: string;
  resolutionType: string;
  resolutionSummary: string;
  incidentVersion: number;
  actor: string;
}) {
  const repo = createPostgresIncidentRepository();
  parseResolutionType(input.resolutionType);
  return resolveIncident(repo, input.incidentId, {
    resolutionType: input.resolutionType,
    resolutionSummary: input.resolutionSummary,
    actor: input.actor,
    incidentVersion: input.incidentVersion,
  });
}
