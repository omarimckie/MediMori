import {
  OBSERVATION_SLOT_SECONDS,
  STALE_THRESHOLD_MS,
  WATCHDOG_STATE_ID,
} from "./constants";
import type {
  IncidentNotificationState,
  NotificationEligibility,
  PushClaimStatus,
  WatchdogState,
} from "./types";

export function computeObservationSlotId(nowMs: number): number {
  const slotSeconds = OBSERVATION_SLOT_SECONDS;
  return Math.floor(nowMs / 1000 / slotSeconds);
}

export function primaryHeartbeatAgeMs(
  lastSeenAt: string | null,
  nowMs: number,
): number | null {
  if (lastSeenAt == null) {
    return null;
  }
  const seenMs = Date.parse(lastSeenAt);
  if (Number.isNaN(seenMs)) {
    return null;
  }
  return nowMs - seenMs;
}

/** Stale when age is strictly greater than 30 minutes. */
export function isPrimaryHeartbeatStale(lastSeenAt: string | null, nowMs: number): boolean {
  const age = primaryHeartbeatAgeMs(lastSeenAt, nowMs);
  if (age == null) {
    return true;
  }
  return age > STALE_THRESHOLD_MS;
}

export function isActivationPending(state: WatchdogState): boolean {
  return state.primaryQstashActivatedAt == null;
}

export function isMaintenanceActive(
  windows: Array<{ startsAt: string; endsAt: string }>,
  nowMs: number,
): boolean {
  return windows.some((window) => {
    const start = Date.parse(window.startsAt);
    const end = Date.parse(window.endsAt);
    return !Number.isNaN(start) && !Number.isNaN(end) && start <= nowMs && nowMs < end;
  });
}

export function outageNotificationWasSent(
  notification: IncidentNotificationState | null,
): boolean {
  if (!notification) {
    return false;
  }
  if (notification.outagePushSentAt != null) {
    return true;
  }
  return (
    notification.outagePushClaimStatus === "delivered" ||
    notification.outagePushClaimStatus === "ambiguous"
  );
}

export function createInitialWatchdogState(nowIso: string): WatchdogState {
  return {
    id: WATCHDOG_STATE_ID,
    primaryQstashActivatedAt: null,
    consecutiveStaleObservations: 0,
    lastPrimaryLastSeenAt: null,
    lastCommittedObservationSlotId: -1,
    lastObservationWasStale: false,
    activeIncidentId: null,
    deferredOutagePush: false,
    updatedAt: nowIso,
  };
}

export function createIncidentNotificationState(
  incidentId: string,
  nowIso: string,
): IncidentNotificationState {
  return {
    incidentId,
    outagePushClaimStatus: "none",
    recoveryPushClaimStatus: "none",
    outagePushSentAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export type ApplyCommittedObservationInput = {
  state: WatchdogState;
  incidentNotification: IncidentNotificationState | null;
  primaryLastSeenAt: string | null;
  stale: boolean;
  nowMs: number;
  nowIso: string;
  observationSlotId: number;
  maintenanceActive: boolean;
  createIncidentId: () => string;
};

export type ApplyCommittedObservationResult = {
  state: WatchdogState;
  incidentNotification: IncidentNotificationState | null;
  openedIncidentId: string | null;
  resolvedIncidentId: string | null;
  notificationEligibility: NotificationEligibility;
};

function computeNotificationEligibility(input: {
  state: WatchdogState;
  incidentNotification: IncidentNotificationState | null;
  maintenanceActive: boolean;
  stale: boolean;
}): NotificationEligibility {
  const { state, incidentNotification, maintenanceActive, stale } = input;

  const outageThresholdMet =
    !isActivationPending(state) &&
    state.consecutiveStaleObservations >= 2 &&
    Boolean(state.activeIncidentId) &&
    Boolean(incidentNotification);

  let outageNotificationEligible = false;
  if (outageThresholdMet && stale && incidentNotification && !maintenanceActive) {
    const blocked = isOutagePushDuplicateBlocked(incidentNotification.outagePushClaimStatus);
    if (!blocked && !outageNotificationWasSent(incidentNotification)) {
      outageNotificationEligible = true;
    }
  }

  let recoveryNotificationEligible = false;
  if (!stale && state.activeIncidentId && incidentNotification) {
    if (outageNotificationWasSent(incidentNotification)) {
      const recoveryBlocked =
        incidentNotification.recoveryPushClaimStatus === "delivered" ||
        incidentNotification.recoveryPushClaimStatus === "ambiguous";
      if (!recoveryBlocked) {
        recoveryNotificationEligible = true;
      }
    }
  }

  return {
    outageNotificationEligible,
    recoveryNotificationEligible,
    deferredOutagePending:
      Boolean(state.deferredOutagePush) &&
      Boolean(incidentNotification) &&
      !outageNotificationWasSent(incidentNotification),
  };
}

export function applyCommittedObservation(
  input: ApplyCommittedObservationInput,
): ApplyCommittedObservationResult {
  const state: WatchdogState = { ...input.state, updatedAt: input.nowIso };
  let incidentNotification = input.incidentNotification
    ? { ...input.incidentNotification, updatedAt: input.nowIso }
    : null;
  let openedIncidentId: string | null = null;
  let resolvedIncidentId: string | null = null;

  state.lastPrimaryLastSeenAt = input.primaryLastSeenAt;
  state.lastCommittedObservationSlotId = input.observationSlotId;

  if (isActivationPending(state)) {
    state.lastObservationWasStale = input.stale;
    return {
      state,
      incidentNotification,
      openedIncidentId,
      resolvedIncidentId,
      notificationEligibility: {
        outageNotificationEligible: false,
        recoveryNotificationEligible: false,
        deferredOutagePending: false,
      },
    };
  }

  if (!input.stale) {
    const notificationEligibility = computeNotificationEligibility({
      state,
      incidentNotification,
      maintenanceActive: input.maintenanceActive,
      stale: false,
    });

    state.consecutiveStaleObservations = 0;
    state.lastObservationWasStale = false;
    state.deferredOutagePush = false;

    if (state.activeIncidentId && incidentNotification) {
      resolvedIncidentId = state.activeIncidentId;
      state.activeIncidentId = null;
    }

    return {
      state,
      incidentNotification,
      openedIncidentId,
      resolvedIncidentId,
      notificationEligibility,
    };
  }

  state.consecutiveStaleObservations = state.lastObservationWasStale
    ? state.consecutiveStaleObservations + 1
    : 1;
  state.lastObservationWasStale = true;

  const outageThresholdMet = state.consecutiveStaleObservations >= 2;

  if (outageThresholdMet && !state.activeIncidentId) {
    openedIncidentId = input.createIncidentId();
    state.activeIncidentId = openedIncidentId;
    incidentNotification = createIncidentNotificationState(openedIncidentId, input.nowIso);
  }

  if (outageThresholdMet && input.maintenanceActive) {
    state.deferredOutagePush = true;
  }

  if (
    !input.maintenanceActive &&
    state.deferredOutagePush &&
    outageThresholdMet &&
    !outageNotificationWasSent(incidentNotification)
  ) {
    // Maintenance ended while still stale — deferred outage remains eligible via notificationEligibility.
  }

  const notificationEligibility = computeNotificationEligibility({
    state,
    incidentNotification,
    maintenanceActive: input.maintenanceActive,
    stale: true,
  });

  return {
    state,
    incidentNotification,
    openedIncidentId,
    resolvedIncidentId,
    notificationEligibility,
  };
}

/** Models post-send claim finalization (no network I/O). */
export function finalizeOutagePushClaim(
  notification: IncidentNotificationState,
  pushDelivered: number,
  nowIso: string,
): IncidentNotificationState {
  const next: IncidentNotificationState = { ...notification, updatedAt: nowIso };
  if (pushDelivered > 0) {
    next.outagePushClaimStatus = "delivered";
    next.outagePushSentAt = nowIso;
    return next;
  }
  next.outagePushClaimStatus = "failed";
  return next;
}

export function markOutagePushAmbiguous(
  notification: IncidentNotificationState,
  nowIso: string,
): IncidentNotificationState {
  return {
    ...notification,
    outagePushClaimStatus: "ambiguous",
    outagePushSentAt: notification.outagePushSentAt ?? nowIso,
    updatedAt: nowIso,
  };
}

export function finalizeRecoveryPushClaim(
  notification: IncidentNotificationState,
  pushDelivered: number,
  nowIso: string,
): IncidentNotificationState {
  const next: IncidentNotificationState = { ...notification, updatedAt: nowIso };
  if (pushDelivered > 0) {
    next.recoveryPushClaimStatus = "delivered";
    return next;
  }
  next.recoveryPushClaimStatus = "failed";
  return next;
}

export function isOutagePushDuplicateBlocked(status: PushClaimStatus): boolean {
  return status === "delivered" || status === "ambiguous";
}
