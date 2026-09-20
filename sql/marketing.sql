-- Marketing Autopilot schema for the existing twilightFeather Neon/Postgres database.
-- Reuses purchases/entitlements for conversion data. Does not duplicate books, users, or customers.

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  primary_audience TEXT NOT NULL,
  secondary_audience TEXT,
  core_message TEXT NOT NULL,
  content_themes JSONB NOT NULL DEFAULT '[]'::jsonb,
  channel_distribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommended_frequency JSONB NOT NULL DEFAULT '{}'::jsonb,
  cta TEXT,
  required_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  measurement_goals JSONB NOT NULL DEFAULT '[]'::jsonb,
  book_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  start_on DATE,
  end_on DATE,
  created_by TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_campaigns_status_idx
  ON marketing_campaigns (status, created_at DESC);

CREATE TABLE IF NOT EXISTS marketing_weekly_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES marketing_campaigns (id) ON DELETE SET NULL,
  week_start DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_weekly_plans_week_campaign_idx
  ON marketing_weekly_plans (week_start, COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS marketing_weekly_plans_campaign_idx
  ON marketing_weekly_plans (campaign_id, week_start DESC);

CREATE TABLE IF NOT EXISTS marketing_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  book_id TEXT,
  character_id TEXT,
  campaign_id UUID REFERENCES marketing_campaigns (id) ON DELETE SET NULL,
  approved BOOLEAN NOT NULL DEFAULT false,
  usage_restrictions TEXT,
  aspect_ratio TEXT,
  image_width INTEGER,
  image_height INTEGER,
  mime_type TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  url TEXT,
  alt_text TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_assets_book_idx ON marketing_assets (book_id);
CREATE INDEX IF NOT EXISTS marketing_assets_approved_idx ON marketing_assets (approved, type);

CREATE TABLE IF NOT EXISTS marketing_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  platform TEXT,
  structure JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_templates_category_idx
  ON marketing_templates (category, platform);

CREATE TABLE IF NOT EXISTS marketing_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES marketing_campaigns (id) ON DELETE SET NULL,
  weekly_plan_id UUID REFERENCES marketing_weekly_plans (id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  format TEXT NOT NULL,
  category TEXT NOT NULL,
  audience TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT,
  body TEXT NOT NULL,
  cta TEXT,
  seo_title TEXT,
  seo_description TEXT,
  scheduled_for TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  asset_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  needs_new_asset BOOLEAN NOT NULL DEFAULT false,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  safety_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  tracking_token TEXT UNIQUE,
  original_body TEXT,
  book_id TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_content_status_idx
  ON marketing_content (status, scheduled_for);
CREATE INDEX IF NOT EXISTS marketing_content_campaign_idx
  ON marketing_content (campaign_id, platform, category);
CREATE INDEX IF NOT EXISTS marketing_content_plan_idx
  ON marketing_content (weekly_plan_id);

CREATE TABLE IF NOT EXISTS marketing_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES marketing_content (id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor TEXT,
  feedback TEXT,
  previous_body TEXT,
  new_body TEXT,
  preference_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_approvals_content_idx
  ON marketing_approvals (content_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketing_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES marketing_content (id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES marketing_campaigns (id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  idempotency_key TEXT NOT NULL UNIQUE,
  external_id TEXT,
  url TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  scheduled_for TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_publications_due_idx
  ON marketing_publications (status, scheduled_for);
CREATE INDEX IF NOT EXISTS marketing_publications_content_idx
  ON marketing_publications (content_id);

CREATE TABLE IF NOT EXISTS marketing_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID REFERENCES marketing_content (id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES marketing_campaigns (id) ON DELETE SET NULL,
  platform TEXT,
  metric_date DATE NOT NULL DEFAULT CURRENT_DATE,
  impressions INTEGER NOT NULL DEFAULT 0,
  engagements INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  email_opens INTEGER NOT NULL DEFAULT 0,
  email_clicks INTEGER NOT NULL DEFAULT 0,
  website_sessions INTEGER NOT NULL DEFAULT 0,
  book_page_views INTEGER NOT NULL DEFAULT 0,
  attributed_purchases INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'mock',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_metrics_campaign_date_idx
  ON marketing_metrics (campaign_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS marketing_metrics_content_idx
  ON marketing_metrics (content_id, metric_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS marketing_metrics_content_date_source_uidx
  ON marketing_metrics (content_id, metric_date, source)
  WHERE content_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS marketing_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  statement TEXT NOT NULL,
  source TEXT NOT NULL,
  strength TEXT NOT NULL DEFAULT 'signal',
  active BOOLEAN NOT NULL DEFAULT true,
  owner_confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_preferences_active_idx
  ON marketing_preferences (active, owner_confirmed, category);

CREATE TABLE IF NOT EXISTS marketing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  book_id TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  origin TEXT NOT NULL DEFAULT 'seed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_rules_kind_idx
  ON marketing_rules (kind, active);

CREATE TABLE IF NOT EXISTS marketing_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES marketing_campaigns (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  reason TEXT NOT NULL,
  supporting_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_strength TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS marketing_recommendations_status_idx
  ON marketing_recommendations (status, created_at DESC);

CREATE TABLE IF NOT EXISTS marketing_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_or_service TEXT,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  campaign_id UUID REFERENCES marketing_campaigns (id) ON DELETE SET NULL,
  content_id UUID REFERENCES marketing_content (id) ON DELETE SET NULL,
  success BOOLEAN NOT NULL DEFAULT true,
  duration_ms INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_operations_created_idx
  ON marketing_operations (created_at DESC);
CREATE INDEX IF NOT EXISTS marketing_operations_campaign_idx
  ON marketing_operations (campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  campaign_id UUID,
  content_id UUID,
  platform TEXT,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_events_name_idx
  ON marketing_events (name, created_at DESC);
CREATE INDEX IF NOT EXISTS marketing_events_campaign_idx
  ON marketing_events (campaign_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketing_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL,
  content_id UUID REFERENCES marketing_content (id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES marketing_campaigns (id) ON DELETE SET NULL,
  book_id TEXT,
  destination_path TEXT NOT NULL,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_clicks_content_idx
  ON marketing_clicks (content_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS marketing_clicks_campaign_idx
  ON marketing_clicks (campaign_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS marketing_clicks_token_clicked_idx
  ON marketing_clicks (token, clicked_at DESC);

CREATE TABLE IF NOT EXISTS marketing_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
