import { getSql } from "@/lib/db";

export type MorningBriefDeliveryClaimStatus =
  | "claimed"
  | "delivered"
  | "failed"
  | "ambiguous";

export type MorningBriefDeliveryClaimRecord = {
  dedupeKey: string;
  timezone: string;
  localDate: string;
  status: MorningBriefDeliveryClaimStatus;
  notificationId: string | null;
  claimedAt: string;
  completedAt: string | null;
};

export type MorningBriefDeliveryClaimRepository = {
  tryClaim(input: {
    dedupeKey: string;
    timezone: string;
    localDate: string;
  }): Promise<"claimed" | "exists">;
  /**
   * Re-open a terminal failed claim for same-day retry when zero pushes were accepted.
   * Never reclaims delivered, ambiguous, or in-flight claimed rows.
   */
  reclaimFailedClaim(dedupeKey: string): Promise<boolean>;
  completeClaim(input: {
    dedupeKey: string;
    status: Exclude<MorningBriefDeliveryClaimStatus, "claimed">;
    notificationId?: string | null;
  }): Promise<boolean>;
  getClaim(dedupeKey: string): Promise<MorningBriefDeliveryClaimRecord | null>;
};

const memoryClaims = new Map<string, MorningBriefDeliveryClaimRecord>();

export function resetMorningBriefDeliveryClaimsForTests(): void {
  memoryClaims.clear();
}

export function createMemoryMorningBriefDeliveryClaimRepository(): MorningBriefDeliveryClaimRepository {
  return {
    async tryClaim(input) {
      if (memoryClaims.has(input.dedupeKey)) {
        return "exists";
      }
      memoryClaims.set(input.dedupeKey, {
        dedupeKey: input.dedupeKey,
        timezone: input.timezone,
        localDate: input.localDate,
        status: "claimed",
        notificationId: null,
        claimedAt: new Date().toISOString(),
        completedAt: null,
      });
      return "claimed";
    },
    async reclaimFailedClaim(dedupeKey) {
      const row = memoryClaims.get(dedupeKey);
      if (!row || row.status !== "failed") {
        return false;
      }
      row.status = "claimed";
      row.notificationId = null;
      row.completedAt = null;
      return true;
    },
    async completeClaim(input) {
      const row = memoryClaims.get(input.dedupeKey);
      if (!row || row.status !== "claimed") {
        return false;
      }
      row.status = input.status;
      row.notificationId = input.notificationId ?? null;
      row.completedAt = new Date().toISOString();
      return true;
    },
    async getClaim(dedupeKey) {
      return memoryClaims.get(dedupeKey) ?? null;
    },
  };
}

function mapClaimRow(row: Record<string, unknown>): MorningBriefDeliveryClaimRecord {
  return {
    dedupeKey: String(row.dedupe_key),
    timezone: String(row.timezone),
    localDate: String(row.local_date),
    status: String(row.status) as MorningBriefDeliveryClaimStatus,
    notificationId: row.notification_id == null ? null : String(row.notification_id),
    claimedAt: new Date(String(row.claimed_at)).toISOString(),
    completedAt:
      row.completed_at == null ? null : new Date(String(row.completed_at)).toISOString(),
  };
}

export function createPostgresMorningBriefDeliveryClaimRepository(): MorningBriefDeliveryClaimRepository {
  return {
    async tryClaim(input) {
      const sql = getSql();
      const rows = await sql`
        INSERT INTO marketing_morning_brief_delivery_claims (
          dedupe_key, timezone, local_date, status
        ) VALUES (
          ${input.dedupeKey},
          ${input.timezone},
          ${input.localDate},
          'claimed'
        )
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING dedupe_key
      `;
      return rows.length > 0 ? "claimed" : "exists";
    },
    async reclaimFailedClaim(dedupeKey) {
      const sql = getSql();
      const rows = await sql`
        UPDATE marketing_morning_brief_delivery_claims
        SET
          status = 'claimed',
          notification_id = NULL,
          completed_at = NULL
        WHERE dedupe_key = ${dedupeKey}
          AND status = 'failed'
        RETURNING dedupe_key
      `;
      return rows.length > 0;
    },
    async completeClaim(input) {
      const sql = getSql();
      const rows = await sql`
        UPDATE marketing_morning_brief_delivery_claims
        SET
          status = ${input.status},
          notification_id = ${input.notificationId ?? null}::uuid,
          completed_at = now()
        WHERE dedupe_key = ${input.dedupeKey}
          AND status = 'claimed'
        RETURNING dedupe_key
      `;
      return rows.length > 0;
    },
    async getClaim(dedupeKey) {
      const sql = getSql();
      const rows = await sql`
        SELECT *
        FROM marketing_morning_brief_delivery_claims
        WHERE dedupe_key = ${dedupeKey}
        LIMIT 1
      `;
      const row = rows[0] as Record<string, unknown> | undefined;
      return row ? mapClaimRow(row) : null;
    },
  };
}

let claimRepositoryOverride: MorningBriefDeliveryClaimRepository | null = null;

export function setMorningBriefDeliveryClaimRepositoryForTests(
  repo: MorningBriefDeliveryClaimRepository | null,
): void {
  claimRepositoryOverride = repo;
}

export function resolveMorningBriefDeliveryClaimRepository(): MorningBriefDeliveryClaimRepository {
  if (claimRepositoryOverride) {
    return claimRepositoryOverride;
  }
  return createPostgresMorningBriefDeliveryClaimRepository();
}
