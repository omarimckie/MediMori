-- Phase III-A2: link admin notifications to durable marketing incidents (nullable FK).

ALTER TABLE marketing_admin_notifications
  ADD COLUMN IF NOT EXISTS related_incident_id UUID
  REFERENCES marketing_incidents (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS marketing_admin_notifications_related_incident_idx
  ON marketing_admin_notifications (related_incident_id)
  WHERE related_incident_id IS NOT NULL;
