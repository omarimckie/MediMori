export class IncidentDedupeResolvedError extends Error {
  readonly dedupeKey: string;
  readonly incidentId: string;

  constructor(dedupeKey: string, incidentId: string) {
    super(
      `Incident with dedupe_key "${dedupeKey}" is resolved. Set reopenIfResolved to record recurrence.`,
    );
    this.name = "IncidentDedupeResolvedError";
    this.dedupeKey = dedupeKey;
    this.incidentId = incidentId;
  }
}

export class IncidentVersionConflictError extends Error {
  constructor(incidentId: string) {
    super(`Incident ${incidentId} version conflict during update.`);
    this.name = "IncidentVersionConflictError";
  }
}

export class IncidentUniqueViolationError extends Error {
  constructor(dedupeKey: string) {
    super(`Incident dedupe_key unique violation: ${dedupeKey}`);
    this.name = "IncidentUniqueViolationError";
  }
}
