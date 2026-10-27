export type PushClaimStatus =
  | "none"
  | "claimed"
  | "delivered"
  | "ambiguous"
  | "failed";

export type ObservationOutcome =
  | "committed"
  | "duplicate_slot"
  | "ignored_late_slot"
  | "ignored_not_activated";

export type WatchdogState = {
  id: string;
  primaryQstashActivatedAt: string | null;
  consecutiveStaleObservations: number;
  lastPrimaryLastSeenAt: string | null;
  lastCommittedObservationSlotId: number;
  lastObservationWasStale: boolean;
  activeIncidentId: string | null;
  deferredOutagePush: boolean;
  updatedAt: string;
};

export type IncidentNotificationState = {
  incidentId: string;
  outagePushClaimStatus: PushClaimStatus;
  recoveryPushClaimStatus: PushClaimStatus;
  outagePushSentAt: string | null;
  outagePushClaimNonce: string | null;
  outagePushAttemptStartedAt: string | null;
  outagePushAdminNotificationId: string | null;
  recoveryPushClaimNonce: string | null;
  recoveryPushAttemptStartedAt: string | null;
  recoveryPushAdminNotificationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PushClaimAcquireResult =
  | { status: "acquired"; claimNonce: string }
  | { status: "blocked" }
  | { status: "missing" };

export type BeginPushAttemptResult =
  | { ok: true }
  | { ok: false; code: string };

export type MaintenanceWindow = {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  createdBy: string;
  createdAt: string;
};

export type PrimaryHeartbeatSnapshot = {
  source: typeof import("./constants").PRIMARY_QSTASH_HEARTBEAT_SOURCE;
  lastSeenAt: string | null;
};

export type WatchdogPrimaryActivationEvidence = {
  verificationKind: "qstash_signature_verified";
  verifiedAt: string;
  attestationId?: string;
};

export type CommitObservationInput = {
  now: Date;
  primaryLastSeenAt: string | null;
  githubRunId?: string | null;
  githubRunAttempt?: string | null;
};

export type NotificationEligibility = {
  outageNotificationEligible: boolean;
  recoveryNotificationEligible: boolean;
  deferredOutagePending: boolean;
};

export type CommitObservationResult = {
  outcome: ObservationOutcome;
  observationSlotId: number;
  activationPending: boolean;
  stale: boolean;
  state: WatchdogState;
  incidentNotification: IncidentNotificationState | null;
  notificationEligibility: NotificationEligibility;
  openedIncidentId: string | null;
  resolvedIncidentId: string | null;
};

/**
 * Post-P0: wire to recordIncident / resolveIncident.
 * P0 generates incident ids locally without touching the incidents module.
 */
export type WatchdogIncidentIntegration = {
  openDispatcherOutageIncident(input: {
    detectedAt: string;
    evidence: Record<string, unknown>;
  }): Promise<{ incidentId: string }>;
  resolveDispatcherIncident(input: {
    incidentId: string;
    resolvedAt: string;
    resolutionSummary: string;
  }): Promise<void>;
};
