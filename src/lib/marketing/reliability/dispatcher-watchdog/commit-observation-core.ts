import {
  applyCommittedObservation,
  computeObservationSlotId,
  createInitialWatchdogState,
  isActivationPending,
  isMaintenanceActive,
  isPrimaryHeartbeatStale,
} from "./evaluate";
import type {
  CommitObservationInput,
  CommitObservationResult,
  IncidentNotificationState,
  ObservationOutcome,
  WatchdogState,
} from "./types";

export type WatchdogCommitStore = {
  getState(): WatchdogState;
  setState(state: WatchdogState): void;
  hasObservationSlot(slotId: number): boolean;
  addObservationSlot(slotId: number): void;
  getIncidentNotification(incidentId: string): IncidentNotificationState | null;
  setIncidentNotification(row: IncidentNotificationState): void;
  listMaintenanceWindows(): Array<{ startsAt: string; endsAt: string }>;
};

export function buildCommitObservationResult(input: {
  outcome: ObservationOutcome;
  observationSlotId: number;
  activationPending: boolean;
  stale: boolean;
  state: WatchdogState;
  incidentNotification: IncidentNotificationState | null;
  openedIncidentId?: string | null;
  resolvedIncidentId?: string | null;
  notificationEligibility?: CommitObservationResult["notificationEligibility"];
}): CommitObservationResult {
  return {
    outcome: input.outcome,
    observationSlotId: input.observationSlotId,
    activationPending: input.activationPending,
    stale: input.stale,
    state: input.state,
    incidentNotification: input.incidentNotification,
    notificationEligibility:
      input.notificationEligibility ?? {
        outageNotificationEligible: false,
        recoveryNotificationEligible: false,
        deferredOutagePending: input.state.deferredOutagePush,
      },
    openedIncidentId: input.openedIncidentId ?? null,
    resolvedIncidentId: input.resolvedIncidentId ?? null,
  };
}

export function commitObservationCore(
  store: WatchdogCommitStore,
  input: CommitObservationInput,
): CommitObservationResult {
  const now = input.now;
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  let state = store.getState();
  if (!state.id) {
    state = createInitialWatchdogState(nowIso);
    store.setState(state);
  }

  const observationSlotId = computeObservationSlotId(nowMs);
  const stale = isPrimaryHeartbeatStale(input.primaryLastSeenAt, nowMs);
  const activationPending = isActivationPending(state);

  if (store.hasObservationSlot(observationSlotId)) {
    return buildCommitObservationResult({
      outcome: "duplicate_slot",
      observationSlotId,
      activationPending,
      stale,
      state,
      incidentNotification: state.activeIncidentId
        ? store.getIncidentNotification(state.activeIncidentId)
        : null,
    });
  }

  if (observationSlotId < state.lastCommittedObservationSlotId) {
    return buildCommitObservationResult({
      outcome: "ignored_late_slot",
      observationSlotId,
      activationPending,
      stale,
      state,
      incidentNotification: state.activeIncidentId
        ? store.getIncidentNotification(state.activeIncidentId)
        : null,
    });
  }

  store.addObservationSlot(observationSlotId);

  if (activationPending) {
    const nextState: WatchdogState = {
      ...state,
      lastPrimaryLastSeenAt: input.primaryLastSeenAt,
      lastCommittedObservationSlotId: observationSlotId,
      lastObservationWasStale: stale,
      updatedAt: nowIso,
    };
    store.setState(nextState);
    return buildCommitObservationResult({
      outcome: "ignored_not_activated",
      observationSlotId,
      activationPending: true,
      stale,
      state: nextState,
      incidentNotification: null,
    });
  }

  const maintenanceActive = isMaintenanceActive(store.listMaintenanceWindows(), nowMs);
  const incidentNotification = state.activeIncidentId
    ? store.getIncidentNotification(state.activeIncidentId)
    : null;

  const applied = applyCommittedObservation({
    state,
    incidentNotification,
    primaryLastSeenAt: input.primaryLastSeenAt,
    stale,
    nowMs,
    nowIso,
    observationSlotId,
    maintenanceActive,
    createIncidentId: () => crypto.randomUUID(),
  });

  store.setState(applied.state);
  if (applied.openedIncidentId && applied.incidentNotification) {
    store.setIncidentNotification(applied.incidentNotification);
  } else if (applied.state.activeIncidentId && applied.incidentNotification) {
    store.setIncidentNotification(applied.incidentNotification);
  }

  return buildCommitObservationResult({
    outcome: "committed",
    observationSlotId,
    activationPending: false,
    stale,
    state: applied.state,
    incidentNotification: applied.state.activeIncidentId
      ? store.getIncidentNotification(applied.state.activeIncidentId)
      : applied.incidentNotification,
    notificationEligibility: applied.notificationEligibility,
    openedIncidentId: applied.openedIncidentId,
    resolvedIncidentId: applied.resolvedIncidentId,
  });
}
