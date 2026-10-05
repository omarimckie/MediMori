import { getSql } from "@/lib/db";
import type {
  MarketingAdminNotificationRecord,
  MarketingNotificationDeliveryStatus,
  MarketingNotificationPayload,
  MarketingNotificationSeverity,
  MarketingNotificationType,
  MarketingPushSubscriptionRecord,
} from "./types";

function mapSubscription(row: Record<string, unknown>): MarketingPushSubscriptionRecord {
  return {
    id: String(row.id),
    adminUsername: String(row.admin_username),
    endpoint: String(row.endpoint),
    p256dh: String(row.p256dh),
    auth: String(row.auth),
    userAgent: row.user_agent == null ? null : String(row.user_agent),
    enabled: Boolean(row.enabled),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    lastSuccessAt:
      row.last_success_at == null
        ? null
        : new Date(String(row.last_success_at)).toISOString(),
    lastFailureAt:
      row.last_failure_at == null
        ? null
        : new Date(String(row.last_failure_at)).toISOString(),
    failureCount: Number(row.failure_count ?? 0),
  };
}

function mapNotification(row: Record<string, unknown>): MarketingAdminNotificationRecord {
  return {
    id: String(row.id),
    type: String(row.type) as MarketingNotificationType,
    severity: String(row.severity) as MarketingNotificationSeverity,
    title: String(row.title),
    body: String(row.body),
    destination: String(row.destination),
    relatedContentId:
      row.related_content_id == null ? null : String(row.related_content_id),
    relatedPublicationId:
      row.related_publication_id == null ? null : String(row.related_publication_id),
    deliveryStatus: String(row.delivery_status) as MarketingNotificationDeliveryStatus,
    deliveryAttemptedAt:
      row.delivery_attempted_at == null
        ? null
        : new Date(String(row.delivery_attempted_at)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString(),
    readAt: row.read_at == null ? null : new Date(String(row.read_at)).toISOString(),
  };
}

export async function upsertPushSubscription(input: {
  adminUsername: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<MarketingPushSubscriptionRecord> {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO marketing_push_subscriptions (
      admin_username, endpoint, p256dh, auth, user_agent, enabled, updated_at
    ) VALUES (
      ${input.adminUsername},
      ${input.endpoint},
      ${input.p256dh},
      ${input.auth},
      ${input.userAgent ?? null},
      true,
      now()
    )
    ON CONFLICT (endpoint) DO UPDATE SET
      admin_username = EXCLUDED.admin_username,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_agent = COALESCE(EXCLUDED.user_agent, marketing_push_subscriptions.user_agent),
      enabled = true,
      updated_at = now()
    RETURNING *
  `;
  return mapSubscription(rows[0] as Record<string, unknown>);
}

export async function disablePushSubscriptionByEndpoint(endpoint: string): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    UPDATE marketing_push_subscriptions
    SET enabled = false, updated_at = now()
    WHERE endpoint = ${endpoint}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function disablePushSubscriptionForAdmin(
  adminUsername: string,
  endpoint: string,
): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    UPDATE marketing_push_subscriptions
    SET enabled = false, updated_at = now()
    WHERE endpoint = ${endpoint} AND admin_username = ${adminUsername}
    RETURNING id
  `;
  return rows.length > 0;
}

export async function listEnabledPushSubscriptionsForAdmin(
  adminUsername: string,
): Promise<MarketingPushSubscriptionRecord[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM marketing_push_subscriptions
    WHERE admin_username = ${adminUsername} AND enabled = true
    ORDER BY updated_at DESC
  `;
  return rows.map((row) => mapSubscription(row as Record<string, unknown>));
}

export async function recordPushSubscriptionSuccess(id: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE marketing_push_subscriptions
    SET
      last_success_at = now(),
      failure_count = 0,
      updated_at = now()
    WHERE id = ${id}::uuid
  `;
}

export async function recordPushSubscriptionFailure(
  id: string,
  permanent: boolean,
): Promise<void> {
  const sql = getSql();
  if (permanent) {
    await sql`
      UPDATE marketing_push_subscriptions
      SET
        enabled = false,
        last_failure_at = now(),
        failure_count = failure_count + 1,
        updated_at = now()
      WHERE id = ${id}::uuid
    `;
    return;
  }
  await sql`
    UPDATE marketing_push_subscriptions
    SET
      last_failure_at = now(),
      failure_count = failure_count + 1,
      updated_at = now()
    WHERE id = ${id}::uuid
  `;
}

export async function createAdminNotification(
  payload: MarketingNotificationPayload,
  deliveryStatus: MarketingNotificationDeliveryStatus = "pending",
): Promise<MarketingAdminNotificationRecord> {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO marketing_admin_notifications (
      type, severity, title, body, destination,
      related_content_id, related_publication_id, delivery_status
    ) VALUES (
      ${payload.type},
      ${payload.severity},
      ${payload.title},
      ${payload.body},
      ${payload.destination},
      ${payload.relatedContentId ?? null},
      ${payload.relatedPublicationId ?? null},
      ${deliveryStatus}
    )
    RETURNING *
  `;
  return mapNotification(rows[0] as Record<string, unknown>);
}

export async function updateAdminNotificationDelivery(
  id: string,
  deliveryStatus: MarketingNotificationDeliveryStatus,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE marketing_admin_notifications
    SET delivery_status = ${deliveryStatus}, delivery_attempted_at = now()
    WHERE id = ${id}::uuid
  `;
}

export async function listAdminNotifications(input?: {
  limit?: number;
  unreadOnly?: boolean;
}): Promise<MarketingAdminNotificationRecord[]> {
  const sql = getSql();
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
  const rows = input?.unreadOnly
    ? await sql`
        SELECT * FROM marketing_admin_notifications
        WHERE read_at IS NULL
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT * FROM marketing_admin_notifications
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
  return rows.map((row) => mapNotification(row as Record<string, unknown>));
}

export async function countUnreadAdminNotifications(): Promise<number> {
  const sql = getSql();
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM marketing_admin_notifications
    WHERE read_at IS NULL
  `;
  return Number((rows[0] as { count: number }).count ?? 0);
}

export async function markAdminNotificationRead(id: string): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    UPDATE marketing_admin_notifications
    SET read_at = COALESCE(read_at, now())
    WHERE id = ${id}::uuid
    RETURNING id
  `;
  return rows.length > 0;
}

export async function markAllAdminNotificationsRead(): Promise<number> {
  const sql = getSql();
  const rows = await sql`
    UPDATE marketing_admin_notifications
    SET read_at = now()
    WHERE read_at IS NULL
    RETURNING id
  `;
  return rows.length;
}
