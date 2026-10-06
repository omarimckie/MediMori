export type MarketingNotificationSeverity = "info" | "warning" | "error";

export type MarketingNotificationType =
  | "test"
  | "morning_brief"
  | "publication_failed"
  | "publication_overdue"
  | "publication_ambiguous"
  | "partial_publication_failure"
  | "credential_warning"
  | "dispatcher_warning";

export type MarketingNotificationDeliveryStatus =
  | "pending"
  | "delivered"
  | "partial"
  | "failed"
  | "skipped";

export type MarketingNotificationPayload = {
  type: MarketingNotificationType;
  severity: MarketingNotificationSeverity;
  title: string;
  body: string;
  destination: string;
  relatedContentId?: string | null;
  relatedPublicationId?: string | null;
  metadata?: Record<string, unknown>;
};

export type MarketingPushSubscriptionRecord = {
  id: string;
  adminUsername: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
};

export type MarketingAdminNotificationRecord = {
  id: string;
  type: MarketingNotificationType;
  severity: MarketingNotificationSeverity;
  title: string;
  body: string;
  destination: string;
  relatedContentId: string | null;
  relatedPublicationId: string | null;
  deliveryStatus: MarketingNotificationDeliveryStatus;
  deliveryAttemptedAt: string | null;
  createdAt: string;
  readAt: string | null;
};

export type MorningBriefPreferences = {
  morningBriefEnabled: boolean;
  morningBriefTime: string;
  timezone: string;
};

export const DEFAULT_MORNING_BRIEF_PREFERENCES: MorningBriefPreferences = {
  morningBriefEnabled: false,
  morningBriefTime: "07:00",
  timezone: "America/New_York",
};

export const MORNING_BRIEF_SETTINGS_KEY = "marketing_morning_brief_preferences";
