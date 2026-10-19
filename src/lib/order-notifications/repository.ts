import { getBookById } from "@/lib/books";
import { getSql } from "@/lib/db";
import type { DigitalPurchaseLine } from "./digital-lines";
import type { OrderKind } from "./privacy";
import { safePushErrorCode } from "./privacy";
import type { OwnerPushJob, OwnerPushJobStatus } from "./process-owner-push";

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

function parseFlags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  return [];
}

function mapJobStatus(value: unknown): OwnerPushJobStatus {
  if (
    value === "queued" ||
    value === "sending" ||
    value === "sent" ||
    value === "failed" ||
    value === "exhausted"
  ) {
    return value;
  }
  return "failed";
}

function mapJob(row: Record<string, unknown>): OwnerPushJob {
  return {
    id: String(row.id),
    dedupeKey: String(row.dedupe_key),
    orderKind: row.order_kind === "digital" ? "digital" : "physical",
    orderId: String(row.order_id),
    stripeCheckoutSessionId: String(row.stripe_checkout_session_id),
    status: mapJobStatus(row.status),
    attemptCount: Number(row.attempt_count ?? 0),
    maxAttempts: Number(row.max_attempts ?? 8),
    title: String(row.title),
    body: String(row.body),
    destination: String(row.destination),
    lastError: row.last_error == null ? null : String(row.last_error),
    claimToken: row.claim_token == null ? null : String(row.claim_token),
  };
}

export async function recordDigitalPurchaseItems(
  purchaseId: string,
  lines: DigitalPurchaseLine[],
): Promise<void> {
  const sql = getSql();
  for (const line of lines) {
    await sql`
      INSERT INTO digital_purchase_items (
        id,
        purchase_id,
        book_id,
        title,
        quantity,
        unit_amount_cents,
        line_amount_cents
      )
      VALUES (
        ${crypto.randomUUID()}::uuid,
        ${purchaseId}::uuid,
        ${line.bookId},
        ${line.title},
        ${line.quantity},
        ${line.unitAmountCents},
        ${line.lineAmountCents}
      )
      ON CONFLICT (purchase_id, book_id) DO NOTHING
    `;
  }
}

export async function listDigitalPurchaseItems(
  purchaseId: string,
): Promise<DigitalPurchaseLine[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT book_id, title, quantity, unit_amount_cents, line_amount_cents
    FROM digital_purchase_items
    WHERE purchase_id = ${purchaseId}::uuid
    ORDER BY created_at ASC
  `;
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      bookId: String(record.book_id),
      title: String(record.title),
      quantity: Number(record.quantity),
      unitAmountCents:
        record.unit_amount_cents == null ? null : Number(record.unit_amount_cents),
      lineAmountCents:
        record.line_amount_cents == null ? null : Number(record.line_amount_cents),
    };
  });
}

export async function upsertOrderAttention(input: {
  orderKind: OrderKind;
  orderId: string;
  attentionFlags: string[];
}): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO order_attention (
      order_kind,
      order_id,
      attention_flags
    )
    VALUES (
      ${input.orderKind},
      ${input.orderId}::uuid,
      ${JSON.stringify(input.attentionFlags)}::jsonb
    )
    ON CONFLICT (order_kind, order_id) DO UPDATE
    SET
      attention_flags = EXCLUDED.attention_flags,
      updated_at = NOW()
  `;
}

export async function getOrderAttention(
  orderKind: OrderKind,
  orderId: string,
): Promise<{ attentionFlags: string[]; acknowledgedAt: Date | null } | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT attention_flags, acknowledged_at
    FROM order_attention
    WHERE order_kind = ${orderKind} AND order_id = ${orderId}::uuid
    LIMIT 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    attentionFlags: parseFlags(row.attention_flags),
    acknowledgedAt: row.acknowledged_at == null ? null : asDate(row.acknowledged_at),
  };
}

export async function acknowledgeOrderAttention(
  orderKind: OrderKind,
  orderId: string,
): Promise<{ wasUnacknowledged: boolean; acknowledgedAt: Date }> {
  const sql = getSql();
  const existing = await sql`
    SELECT acknowledged_at
    FROM order_attention
    WHERE order_kind = ${orderKind} AND order_id = ${orderId}::uuid
    LIMIT 1
  `;
  const current = existing[0] as Record<string, unknown> | undefined;
  if (!current) {
    const inserted = await sql`
      INSERT INTO order_attention (
        order_kind,
        order_id,
        attention_flags,
        acknowledged_at
      )
      VALUES (
        ${orderKind},
        ${orderId}::uuid,
        '[]'::jsonb,
        NOW()
      )
      RETURNING acknowledged_at
    `;
    const row = inserted[0] as Record<string, unknown>;
    return {
      wasUnacknowledged: true,
      acknowledgedAt: asDate(row.acknowledged_at),
    };
  }

  const wasUnacknowledged = current.acknowledged_at == null;
  const updated = await sql`
    UPDATE order_attention
    SET
      acknowledged_at = COALESCE(acknowledged_at, NOW()),
      updated_at = NOW()
    WHERE order_kind = ${orderKind} AND order_id = ${orderId}::uuid
    RETURNING acknowledged_at
  `;
  const row = updated[0] as Record<string, unknown>;
  return {
    wasUnacknowledged,
    acknowledgedAt: asDate(row.acknowledged_at),
  };
}

export async function insertOwnerPushJob(input: {
  id: string;
  dedupeKey: string;
  orderKind: OrderKind;
  orderId: string;
  stripeEventId: string | null;
  stripeCheckoutSessionId: string;
  title: string;
  body: string;
  destination: string;
  backfillRunId?: string | null;
}): Promise<{ created: boolean; job: OwnerPushJob }> {
  const sql = getSql();
  await sql`
    INSERT INTO order_notification_jobs (
      id,
      dedupe_key,
      order_kind,
      order_id,
      stripe_event_id,
      backfill_run_id,
      stripe_checkout_session_id,
      status,
      attempt_count,
      title,
      body,
      destination
    )
    VALUES (
      ${input.id}::uuid,
      ${input.dedupeKey},
      ${input.orderKind},
      ${input.orderId}::uuid,
      ${input.stripeEventId},
      ${input.backfillRunId ?? null}::uuid,
      ${input.stripeCheckoutSessionId},
      'queued',
      0,
      ${input.title},
      ${input.body},
      ${input.destination}
    )
    ON CONFLICT (dedupe_key) DO NOTHING
  `;

  const rows = await sql`
    SELECT id, dedupe_key, order_kind, order_id, stripe_checkout_session_id,
           status, attempt_count, max_attempts, title, body, destination, last_error, claim_token
    FROM order_notification_jobs
    WHERE dedupe_key = ${input.dedupeKey}
    LIMIT 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Order notification job was not recorded.");
  }
  return {
    created: String(row.id) === input.id,
    job: mapJob(row),
  };
}

export async function claimQueuedOwnerPush(jobId: string): Promise<OwnerPushJob | null> {
  const sql = getSql();
  const rows = await sql`
    UPDATE order_notification_jobs
    SET
      status = 'sending',
      claim_token = gen_random_uuid(),
      attempt_count = attempt_count + 1,
      updated_at = NOW()
    WHERE id = ${jobId}::uuid
      AND status = 'queued'
      AND attempt_count < max_attempts
    RETURNING id, dedupe_key, order_kind, order_id, stripe_checkout_session_id,
              status, attempt_count, max_attempts, title, body, destination, last_error, claim_token
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? mapJob(row) : null;
}

export async function markOwnerPushSent(
  jobId: string,
  claimToken: string,
): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    UPDATE order_notification_jobs
    SET
      status = 'sent',
      claim_token = NULL,
      sent_at = NOW(),
      last_error = NULL,
      updated_at = NOW()
    WHERE id = ${jobId}::uuid
      AND status = 'sending'
      AND claim_token = ${claimToken}::uuid
    RETURNING id
  `;
  return rows.length > 0;
}

export async function markOwnerPushFailed(
  jobId: string,
  claimToken: string,
  error: string,
): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    UPDATE order_notification_jobs
    SET
      status = CASE
        WHEN attempt_count >= max_attempts THEN 'exhausted'
        ELSE 'failed'
      END,
      claim_token = NULL,
      last_error = ${safePushErrorCode(error)},
      next_attempt_at = NOW(),
      updated_at = NOW()
    WHERE id = ${jobId}::uuid
      AND status = 'sending'
      AND claim_token = ${claimToken}::uuid
    RETURNING id
  `;
  return rows.length > 0;
}

export async function reclaimStaleSendingOwnerPushJobs(): Promise<number> {
  const sql = getSql();
  const rows = await sql`
    UPDATE order_notification_jobs
    SET
      status = CASE
        WHEN attempt_count >= max_attempts THEN 'exhausted'
        ELSE 'failed'
      END,
      claim_token = NULL,
      next_attempt_at = NOW(),
      updated_at = NOW()
    WHERE status = 'sending'
      AND updated_at < NOW() - INTERVAL '2 minutes'
    RETURNING id
  `;
  return rows.length;
}

export async function claimDueFailedOwnerPushJobs(limit: number): Promise<OwnerPushJob[]> {
  const sql = getSql();
  const rows = await sql`
    UPDATE order_notification_jobs AS jobs
    SET
      status = 'sending',
      claim_token = gen_random_uuid(),
      attempt_count = jobs.attempt_count + 1,
      updated_at = NOW()
    FROM (
      SELECT id
      FROM order_notification_jobs
      WHERE status = 'failed'
        AND attempt_count < max_attempts
        AND next_attempt_at <= NOW()
      ORDER BY created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ) AS due
    WHERE jobs.id = due.id
      AND jobs.status = 'failed'
      AND jobs.attempt_count < jobs.max_attempts
    RETURNING jobs.id, jobs.dedupe_key, jobs.order_kind, jobs.order_id,
              jobs.stripe_checkout_session_id, jobs.status, jobs.attempt_count,
              jobs.max_attempts, jobs.title, jobs.body, jobs.destination,
              jobs.last_error, jobs.claim_token
  `;
  return rows.map((row) => mapJob(row as Record<string, unknown>));
}

export async function claimSpecificFailedOwnerPush(
  jobId: string,
): Promise<OwnerPushJob | null> {
  const sql = getSql();
  const rows = await sql`
    UPDATE order_notification_jobs
    SET
      status = 'sending',
      claim_token = gen_random_uuid(),
      attempt_count = attempt_count + 1,
      updated_at = NOW()
    WHERE id = ${jobId}::uuid
      AND status = 'failed'
      AND claim_token IS NULL
      AND attempt_count < max_attempts
    RETURNING id, dedupe_key, order_kind, order_id, stripe_checkout_session_id,
              status, attempt_count, max_attempts, title, body, destination, last_error, claim_token
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? mapJob(row) : null;
}

export async function getLatestOwnerPushForOrder(
  orderKind: OrderKind,
  orderId: string,
): Promise<OwnerPushJob | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, dedupe_key, order_kind, order_id, stripe_checkout_session_id,
           status, attempt_count, max_attempts, title, body, destination, last_error, claim_token
    FROM order_notification_jobs
    WHERE order_kind = ${orderKind}
      AND order_id = ${orderId}::uuid
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? mapJob(row) : null;
}

export async function findExhaustedOwnerPushForOrder(
  orderKind: OrderKind,
  orderId: string,
): Promise<{ id: string } | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id
    FROM order_notification_jobs
    WHERE order_kind = ${orderKind}
      AND order_id = ${orderId}::uuid
      AND status = 'exhausted'
      AND claim_token IS NULL
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? { id: String(row.id) } : null;
}

export type ExhaustedPushRecovery = {
  jobId: string;
  priorStatus: "exhausted";
  priorAttemptCount: number;
  priorLastError: string | null;
  maxAttempts: number;
};

/**
 * One statement: a zero-row update inserts no audit row.
 * Concurrent recoveries cannot both match exhausted + claim_token IS NULL.
 */
export async function recoverExhaustedOwnerPushJob(input: {
  jobId: string;
  adminUsername: string;
  reason: string;
}): Promise<ExhaustedPushRecovery | null> {
  const sql = getSql();
  const rows = await sql`
    WITH recovered AS (
      UPDATE order_notification_jobs
      SET
        status = 'failed',
        max_attempts = max_attempts + 1,
        next_attempt_at = NOW(),
        updated_at = NOW()
      WHERE id = ${input.jobId}::uuid
        AND status = 'exhausted'
        AND claim_token IS NULL
      RETURNING id, attempt_count, last_error, max_attempts
    ),
    audited AS (
      INSERT INTO order_notification_job_recoveries (
        job_id,
        admin_username,
        prior_status,
        prior_attempt_count,
        prior_last_error,
        reason
      )
      SELECT
        id,
        ${input.adminUsername},
        'exhausted',
        attempt_count,
        last_error,
        ${input.reason}
      FROM recovered
      RETURNING job_id, prior_attempt_count, prior_last_error
    )
    SELECT
      audited.job_id,
      audited.prior_attempt_count,
      audited.prior_last_error,
      recovered.max_attempts
    FROM audited
    JOIN recovered ON recovered.id = audited.job_id
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    jobId: String(row.job_id),
    priorStatus: "exhausted",
    priorAttemptCount: Number(row.prior_attempt_count),
    priorLastError: row.prior_last_error == null ? null : String(row.prior_last_error),
    maxAttempts: Number(row.max_attempts),
  };
}

export type ReleaseWindowOrderRow = {
  kind: OrderKind;
  orderId: string;
  stripeCheckoutSessionId: string;
  occurredAt: Date;
  quantity: number;
  needsAttention: boolean;
  fulfillmentStatus: string | null;
  refundStatus: string | null;
  fullyRefundedAt: Date | null;
  hasNotificationJob: boolean;
};

export async function listReleaseWindowOrders(
  windowStart: Date,
  windowEnd: Date,
): Promise<ReleaseWindowOrderRow[]> {
  const sql = getSql();
  const physical = await sql`
    SELECT
      id,
      stripe_checkout_session_id,
      quantity,
      created_at,
      fulfillment_status,
      shipping_address_missing,
      EXISTS (
        SELECT 1
        FROM order_notification_jobs AS jobs
        WHERE jobs.dedupe_key = 'owner-push:physical:' || physical_orders.stripe_checkout_session_id
      ) AS has_notification_job
    FROM physical_orders
    WHERE created_at >= ${windowStart.toISOString()}::timestamptz
      AND created_at < ${windowEnd.toISOString()}::timestamptz
      AND btrim(stripe_checkout_session_id) <> ''
      AND fulfillment_status IS DISTINCT FROM 'refunded'
  `;
  const digital = await sql`
    SELECT
      id,
      stripe_checkout_session_id,
      purchased_at,
      refund_status,
      fully_refunded_at,
      COALESCE((
        SELECT SUM(items.quantity)::int
        FROM digital_purchase_items AS items
        WHERE items.purchase_id = purchases.id
      ), 1) AS quantity,
      EXISTS (
        SELECT 1
        FROM order_notification_jobs AS jobs
        WHERE jobs.dedupe_key = 'owner-push:digital:' || purchases.stripe_checkout_session_id
      ) AS has_notification_job
    FROM purchases
    WHERE purchased_at >= ${windowStart.toISOString()}::timestamptz
      AND purchased_at < ${windowEnd.toISOString()}::timestamptz
      AND btrim(stripe_checkout_session_id) <> ''
      AND refund_status IS DISTINCT FROM 'fully_refunded'
      AND fully_refunded_at IS NULL
  `;

  const physicalRows = physical.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      kind: "physical" as const,
      orderId: String(record.id),
      stripeCheckoutSessionId: String(record.stripe_checkout_session_id),
      occurredAt: asDate(record.created_at),
      quantity: Number(record.quantity),
      needsAttention: Boolean(record.shipping_address_missing),
      fulfillmentStatus: String(record.fulfillment_status),
      refundStatus: null,
      fullyRefundedAt: null,
      hasNotificationJob: Boolean(record.has_notification_job),
    };
  });
  const digitalRows = digital.map((row) => {
    const record = row as Record<string, unknown>;
    return {
      kind: "digital" as const,
      orderId: String(record.id),
      stripeCheckoutSessionId: String(record.stripe_checkout_session_id),
      occurredAt: asDate(record.purchased_at),
      quantity: Number(record.quantity ?? 1),
      needsAttention: false,
      fulfillmentStatus: null,
      refundStatus: record.refund_status == null ? null : String(record.refund_status),
      fullyRefundedAt:
        record.fully_refunded_at == null ? null : asDate(record.fully_refunded_at),
      hasNotificationJob: Boolean(record.has_notification_job),
    };
  });
  return [...physicalRows, ...digitalRows];
}

export async function insertReleaseWindowBackfill(input: {
  operatorIdentity: string;
  windowStart: Date;
  windowEnd: Date;
  jobs: Array<{
    id: string;
    dedupeKey: string;
    orderKind: OrderKind;
    orderId: string;
    stripeCheckoutSessionId: string;
    title: string;
    body: string;
    destination: string;
  }>;
}): Promise<{ runId: string; insertedJobIds: string[] }> {
  const sql = getSql();
  const runId = crypto.randomUUID();
  await sql.transaction((txn) => [
    txn`
      INSERT INTO order_notification_backfill_runs (
        id,
        source,
        window_start,
        window_end,
        operator_identity
      )
      VALUES (
        ${runId}::uuid,
        'release_window_backfill',
        ${input.windowStart.toISOString()}::timestamptz,
        ${input.windowEnd.toISOString()}::timestamptz,
        ${input.operatorIdentity}
      )
    `,
    ...input.jobs.map(
      (job) => txn`
        INSERT INTO order_notification_jobs (
          id,
          dedupe_key,
          order_kind,
          order_id,
          stripe_event_id,
          backfill_run_id,
          stripe_checkout_session_id,
          status,
          attempt_count,
          title,
          body,
          destination
        )
        VALUES (
          ${job.id}::uuid,
          ${job.dedupeKey},
          ${job.orderKind},
          ${job.orderId}::uuid,
          NULL,
          ${runId}::uuid,
          ${job.stripeCheckoutSessionId},
          'queued',
          0,
          ${job.title},
          ${job.body},
          ${job.destination}
        )
        ON CONFLICT (dedupe_key) DO NOTHING
      `,
    ),
  ]);

  const rows = await sql`
    SELECT id
    FROM order_notification_jobs
    WHERE backfill_run_id = ${runId}::uuid
      AND status = 'queued'
      AND claim_token IS NULL
      AND sent_at IS NULL
      AND attempt_count = 0
  `;
  return {
    runId,
    insertedJobIds: rows.map((row) => String((row as Record<string, unknown>).id)),
  };
}

export async function rollbackReleaseWindowBackfill(runId: string): Promise<string[]> {
  const sql = getSql();
  const rows = await sql`
    DELETE FROM order_notification_jobs
    WHERE backfill_run_id = ${runId}::uuid
      AND status = 'queued'
      AND claim_token IS NULL
      AND sent_at IS NULL
      AND attempt_count = 0
    RETURNING id
  `;
  return rows.map((row) => String((row as Record<string, unknown>).id));
}

export function digitalItemsOrPurchaseFallback(input: {
  bookId: string;
  lines: DigitalPurchaseLine[];
}): DigitalPurchaseLine[] {
  if (input.lines.length) return input.lines;
  const book = getBookById(input.bookId);
  return [
    {
      bookId: input.bookId,
      title: book?.title ?? input.bookId,
      quantity: 1,
      unitAmountCents: null,
      lineAmountCents: null,
    },
  ];
}
