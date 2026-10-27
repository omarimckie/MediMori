-- Marketing Admin Web Push + notification history (owner-only, not visitor marketing).

CREATE TABLE IF NOT EXISTS marketing_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_username TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS marketing_push_subscriptions_admin_idx
  ON marketing_push_subscriptions (admin_username, enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS marketing_admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT '/admin/marketing',
  related_content_id UUID,
  related_publication_id UUID,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  delivery_attempted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS marketing_admin_notifications_created_idx
  ON marketing_admin_notifications (created_at DESC);

CREATE INDEX IF NOT EXISTS marketing_admin_notifications_unread_idx
  ON marketing_admin_notifications (read_at, created_at DESC);
