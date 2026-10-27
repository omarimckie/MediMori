import { IncidentValidationError } from "./validate";
import type { MarketingIncidentStatus } from "./types";

const LEGAL_TRANSITIONS: Record<MarketingIncidentStatus, readonly MarketingIncidentStatus[]> = {
  open: ["investigating", "action_required", "blocked", "resolved"],
  investigating: ["action_required", "blocked", "resolved"],
  action_required: ["investigating", "blocked", "resolved"],
  blocked: ["investigating", "action_required", "resolved"],
  resolved: [],
};

export class IllegalIncidentTransitionError extends IncidentValidationError {
  readonly from: MarketingIncidentStatus;
  readonly to: MarketingIncidentStatus;

  constructor(from: MarketingIncidentStatus, to: MarketingIncidentStatus) {
    super(`Illegal incident status transition: ${from} → ${to}`);
    this.name = "IllegalIncidentTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function assertLegalIncidentTransition(
  from: MarketingIncidentStatus,
  to: MarketingIncidentStatus,
): void {
  if (from === to) return;
  const allowed = LEGAL_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new IllegalIncidentTransitionError(from, to);
  }
}

/** Resolved → open is only legal through explicit reopen / recurrence policy. */
export function assertLegalIncidentReopen(from: MarketingIncidentStatus): void {
  if (from !== "resolved") {
    throw new IllegalIncidentTransitionError(from, "open");
  }
}

export function legalTransitionsFrom(
  status: MarketingIncidentStatus,
): readonly MarketingIncidentStatus[] {
  return LEGAL_TRANSITIONS[status];
}
