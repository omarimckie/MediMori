import { getSql } from "@/lib/db";
import type { MarketingPublication } from "../types";
import type { MarketingDispatcherSource } from "./dispatcher-source";
import {
  PUBLICATION_OVERDUE_THRESHOLD_MS,
  PUBLICATION_STUCK_PROCESSING_THRESHOLD_MS,
} from "./constants";

function mapPublication(row: Record<string, unknown>): MarketingPublication {
  return {
    id: String(row.id),
    contentId: String(row.content_id),
    campaignId: row.campaign_id == null ? null : String(row.campaign_id),
    platform: String(row.platform) as MarketingPublication["platform"],
    provider: String(row.provider),
    status: String(row.status) as MarketingPublication["status"],
    idempotencyKey: String(row.idempotency_key),
    externalId: row.external_id == null ? null : String(row.external_id),
    url: row.url == null ? null : String(row.url),
    attemptCount: Number(row.attempt_count ?? 0),
    lastError: row.last_error == null ? null : String(row.last_error),
    scheduledFor:
      row.scheduled_for == null
        ? null
        : new Date(String(row.scheduled_for)).toISOString(),
    publishedAt:
      row.published_at == null
        ? null
        : new Date(String(row.published_at)).toISOString(),
    ambiguityState: String(row.ambiguity_state ?? "none") as MarketingPublication["ambiguityState"],
    claimToken: row.claim_token == null ? null : String(row.claim_token),
    processingStartedAt:
      row.processing_started_at == null
        ? null
        : new Date(String(row.processing_started_at)).toISOString(),
    providerCreationId:
      row.provider_creation_id == null ? null : String(row.provider_creation_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function overdueIntervalMinutes(thresholdMs: number): number {
  return Math.floor(thresholdMs / 60_000);
}

export async function listOverdueScheduledPublications(
  overdueThresholdMs = PUBLICATION_OVERDUE_THRESHOLD_MS,
): Promise<MarketingPublication[]> {
  const sql = getSql();
  const minutes = overdueIntervalMinutes(overdueThresholdMs);
  const rows = await sql`
    SELECT *
    FROM marketing_publications
    WHERE status = 'scheduled'
      AND scheduled_for IS NOT NULL
      AND scheduled_for <= now() - make_interval(mins => ${minutes})
    ORDER BY scheduled_for ASC
  `;
  return rows.map((row) => mapPublication(row as Record<string, unknown>));
}

export async function listStuckProcessingPublications(
  stuckThresholdMs = PUBLICATION_STUCK_PROCESSING_THRESHOLD_MS,
): Promise<MarketingPublication[]> {
  const sql = getSql();
  const minutes = overdueIntervalMinutes(stuckThresholdMs);
  const rows = await sql`
    SELECT *
    FROM marketing_publications
    WHERE status = 'processing'
      AND updated_at <= now() - make_interval(mins => ${minutes})
    ORDER BY updated_at ASC
  `;
  return rows.map((row) => mapPublication(row as Record<string, unknown>));
}

export async function cleanupResolvedReliabilityDedupes(): Promise<number> {
  const sql = getSql();
  const overdueMinutes = overdueIntervalMinutes(PUBLICATION_OVERDUE_THRESHOLD_MS);
  const stuckMinutes = overdueIntervalMinutes(PUBLICATION_STUCK_PROCESSING_THRESHOLD_MS);
  const rows = await sql`
    DELETE FROM marketing_reliability_dedup d
    WHERE
      (
        d.dedupe_key LIKE 'publication_overdue:%'
        AND NOT EXISTS (
          SELECT 1 FROM marketing_publications p
          WHERE p.id = d.publication_id
            AND p.status = 'scheduled'
            AND p.scheduled_for IS NOT NULL
            AND p.scheduled_for <= now() - make_interval(mins => ${overdueMinutes})
        )
      )
      OR (
        d.dedupe_key LIKE 'publication_ambiguous:processing:%'
        AND NOT EXISTS (
          SELECT 1 FROM marketing_publications p
          WHERE p.id = d.publication_id
            AND p.status = 'processing'
            AND p.updated_at <= now() - make_interval(mins => ${stuckMinutes})
        )
      )
    RETURNING dedupe_key
  `;
  return rows.length;
}

/** Claim dedupe slot before sending notification (prevents push spam on concurrent sweeps). */
export async function claimReliabilityDedupe(input: {
  dedupeKey: string;
  publicationId: string;
}): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO marketing_reliability_dedup (dedupe_key, publication_id, notification_id)
    VALUES (${input.dedupeKey}, ${input.publicationId}::uuid, NULL)
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING dedupe_key
  `;
  return rows.length > 0;
}

export async function attachReliabilityDedupeNotification(input: {
  dedupeKey: string;
  notificationId: string;
}): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE marketing_reliability_dedup
    SET notification_id = ${input.notificationId}::uuid
    WHERE dedupe_key = ${input.dedupeKey}
  `;
}

export async function releaseReliabilityDedupe(dedupeKey: string): Promise<void> {
  const sql = getSql();
  await sql`
    DELETE FROM marketing_reliability_dedup
    WHERE dedupe_key = ${dedupeKey}
  `;
}

export async function recordDispatcherHeartbeat(input: {
  source: MarketingDispatcherSource;
  publishedCount: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const sql = getSql();
  const metadata = JSON.stringify(input.metadata ?? {});
  await sql`
    INSERT INTO marketing_dispatcher_heartbeats (
      source, last_seen_at, last_published_count, metadata
    ) VALUES (
      ${input.source},
      now(),
      ${input.publishedCount},
      ${metadata}::jsonb
    )
    ON CONFLICT (source) DO UPDATE SET
      last_seen_at = EXCLUDED.last_seen_at,
      last_published_count = EXCLUDED.last_published_count,
      metadata = EXCLUDED.metadata
  `;
}
