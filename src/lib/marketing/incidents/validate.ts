import {
  MARKETING_INCIDENT_EVENT_TYPES,
  MARKETING_INCIDENT_SEVERITIES,
  MARKETING_INCIDENT_STATUSES,
  MARKETING_INCIDENT_TYPES,
  PERMITTED_ACTIONS,
  RESOLUTION_TYPES,
  RETRY_SAFETY_VALUES,
  type MarketingIncidentEventType,
  type MarketingIncidentSeverity,
  type MarketingIncidentStatus,
  type MarketingIncidentType,
  type PermittedAction,
  type ResolutionType,
  type RetrySafety,
} from "./types";

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

export class IncidentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncidentValidationError";
  }
}

export function parseIncidentType(value: string): MarketingIncidentType {
  if (!isOneOf(value, MARKETING_INCIDENT_TYPES)) {
    throw new IncidentValidationError(`Unknown incident_type: ${value}`);
  }
  return value;
}

export function parseIncidentStatus(value: string): MarketingIncidentStatus {
  if (!isOneOf(value, MARKETING_INCIDENT_STATUSES)) {
    throw new IncidentValidationError(`Unknown incident status: ${value}`);
  }
  return value;
}

export function parseIncidentSeverity(value: string): MarketingIncidentSeverity {
  if (!isOneOf(value, MARKETING_INCIDENT_SEVERITIES)) {
    throw new IncidentValidationError(`Unknown incident severity: ${value}`);
  }
  return value;
}

export function parseRetrySafety(value: string): RetrySafety {
  if (!isOneOf(value, RETRY_SAFETY_VALUES)) {
    throw new IncidentValidationError(`Unknown retry_safety: ${value}`);
  }
  return value;
}

export function parsePermittedActions(values: readonly string[]): PermittedAction[] {
  const out: PermittedAction[] = [];
  for (const value of values) {
    if (!isOneOf(value, PERMITTED_ACTIONS)) {
      throw new IncidentValidationError(`Unknown permitted_action: ${value}`);
    }
    out.push(value);
  }
  return out;
}

export function parseResolutionType(value: string): ResolutionType {
  if (!isOneOf(value, RESOLUTION_TYPES)) {
    throw new IncidentValidationError(`Unknown resolution_type: ${value}`);
  }
  return value;
}

export function parseIncidentEventType(value: string): MarketingIncidentEventType {
  if (!isOneOf(value, MARKETING_INCIDENT_EVENT_TYPES)) {
    throw new IncidentValidationError(`Unknown incident event type: ${value}`);
  }
  return value;
}
