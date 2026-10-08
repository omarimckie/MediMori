import type { RecordIncidentOutcome } from "../incidents/record-types";

/** B2 rule version stored in incident evidence for future tuning. */
export const PARTIAL_PUBLICATION_FAILURE_RULE_VERSION = "partial_v1";

/**
 * Deploy-time marker (set in Vercel/env when B2 is activated). All partial
 * publication_failure observation (hook and sweep) is off until this is a valid
 * ISO-8601 instant. Pairing requires `publication_failed.first_seen_at` on or
 * after this instant (not publication row `updated_at`, not incident `last_seen_at`).
 */
const ENABLED_AT_ENV = "MARKETING_PARTIAL_PUBLICATION_FAILURE_ENABLED_AT";

let enabledAtIsoOverride: string | null | undefined;

export function getPartialPublicationFailureEnabledAtIso(): string | null {
  if (enabledAtIsoOverride !== undefined) {
    return enabledAtIsoOverride;
  }
  const fromEnv = process.env[ENABLED_AT_ENV]?.trim();
  return fromEnv || null;
}

export function getPartialPublicationFailureEnabledAtMs(): number | null {
  const iso = getPartialPublicationFailureEnabledAtIso();
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Test-only: pass `null` to clear override; omit to leave env/default. */
export function setPartialPublicationFailureEnabledAtForTests(iso: string | null): void {
  enabledAtIsoOverride = iso;
}

export function resetPartialPublicationFailureEnabledAtForTests(): void {
  enabledAtIsoOverride = undefined;
}

export type PartialProspectiveGate =
  | {
      kind: "hook_actionable_failure_transition";
      publicationFailedOutcome: RecordIncidentOutcome;
      /** From the `publication_failed` incident row after record (stable across reopen). */
      publicationFailedFirstSeenAt: string;
    }
  | {
      kind: "sweep_publication_failed_anchor";
      publicationFailedFirstSeenAt: string;
    };

function publicationFailedAnchorPassesProspective(firstSeenAt: string): boolean {
  const enabledAtMs = getPartialPublicationFailureEnabledAtMs();
  if (enabledAtMs == null) {
    return false;
  }
  const anchorMs = Date.parse(firstSeenAt);
  if (!Number.isFinite(anchorMs)) {
    return false;
  }
  return anchorMs >= enabledAtMs;
}

/**
 * Hook: actionable `publication_failed` transition (created/reopened, not occurrence)
 * plus deploy marker and first_seen_at anchor.
 * Sweep: deploy marker and the same first_seen_at anchor on the existing incident.
 */
export function passesPartialProspectiveGate(gate: PartialProspectiveGate): boolean {
  if (gate.kind === "hook_actionable_failure_transition") {
    if (
      gate.publicationFailedOutcome !== "created" &&
      gate.publicationFailedOutcome !== "reopened"
    ) {
      return false;
    }
    return publicationFailedAnchorPassesProspective(gate.publicationFailedFirstSeenAt);
  }
  return publicationFailedAnchorPassesProspective(gate.publicationFailedFirstSeenAt);
}

/** Ops validation: non-empty ISO-8601 UTC instant that parses. */
export function validatePartialPublicationFailureEnabledAt(
  raw: string | undefined | null,
): { ok: true; iso: string } | { ok: false; reason: string } {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return { ok: false, reason: "MARKETING_PARTIAL_PUBLICATION_FAILURE_ENABLED_AT is unset" };
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    return { ok: false, reason: "not a valid ISO-8601 datetime" };
  }
  if (!trimmed.includes("T")) {
    return { ok: false, reason: "must include time (use UTC Z suffix, e.g. 2026-10-08T12:00:00.000Z)" };
  }
  return { ok: true, iso: new Date(ms).toISOString() };
}
