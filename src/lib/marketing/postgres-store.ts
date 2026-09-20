import { getSql } from "@/lib/db";
import {
  mapApproval,
  mapAsset,
  mapCampaign,
  mapClick,
  mapContent,
  mapEvent,
  mapMetric,
  mapOperation,
  mapPlan,
  mapPreference,
  mapPublication,
  mapRecommendation,
  mapRule,
  mapTemplate,
} from "./memory-store";
import type { MarketingStore } from "./store";
import type {
  ContentFilters,
  MarketingApproval,
  MarketingAsset,
  MarketingCampaign,
  MarketingClick,
  MarketingContent,
  MarketingEvent,
  MarketingMetric,
  MarketingOperation,
  MarketingPreference,
  MarketingPublication,
  MarketingRecommendation,
  MarketingRule,
  MarketingTemplate,
  WeeklyPlan,
} from "./types";

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export class PostgresMarketingStore implements MarketingStore {
  async createCampaign(input: Omit<MarketingCampaign, "createdAt" | "updatedAt">) {
    const sql = getSql();
    const rows = await sql`
      INSERT INTO marketing_campaigns (
        id, name, objective, status, primary_audience, secondary_audience,
        core_message, content_themes, channel_distribution, recommended_frequency,
        cta, required_assets, measurement_goals, book_ids, start_on, end_on,
        created_by, is_demo
      ) VALUES (
        ${input.id}::uuid, ${input.name}, ${input.objective}, ${input.status},
        ${input.primaryAudience}, ${input.secondaryAudience}, ${input.coreMessage},
        ${json(input.contentThemes)}::jsonb, ${json(input.channelDistribution)}::jsonb,
        ${json(input.recommendedFrequency)}::jsonb, ${input.cta},
        ${json(input.requiredAssets)}::jsonb, ${json(input.measurementGoals)}::jsonb,
        ${json(input.bookIds)}::jsonb, ${input.startOn}, ${input.endOn},
        ${input.createdBy}, ${input.isDemo}
      )
      RETURNING *
    `;
    return mapCampaign(rows[0] as Record<string, unknown>);
  }

  async updateCampaign(id: string, patch: Partial<MarketingCampaign>) {
    const current = await this.getCampaign(id);
    if (!current) return null;
    const next = { ...current, ...patch, id };
    const sql = getSql();
    const rows = await sql`
      UPDATE marketing_campaigns SET
        name = ${next.name},
        objective = ${next.objective},
        status = ${next.status},
        primary_audience = ${next.primaryAudience},
        secondary_audience = ${next.secondaryAudience},
        core_message = ${next.coreMessage},
        content_themes = ${json(next.contentThemes)}::jsonb,
        channel_distribution = ${json(next.channelDistribution)}::jsonb,
        recommended_frequency = ${json(next.recommendedFrequency)}::jsonb,
        cta = ${next.cta},
        required_assets = ${json(next.requiredAssets)}::jsonb,
        measurement_goals = ${json(next.measurementGoals)}::jsonb,
        book_ids = ${json(next.bookIds)}::jsonb,
        start_on = ${next.startOn},
        end_on = ${next.endOn},
        created_by = ${next.createdBy},
        is_demo = ${next.isDemo},
        updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING *
    `;
    return rows[0] ? mapCampaign(rows[0] as Record<string, unknown>) : null;
  }

  async getCampaign(id: string) {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_campaigns WHERE id = ${id}::uuid LIMIT 1`;
    return rows[0] ? mapCampaign(rows[0] as Record<string, unknown>) : null;
  }

  async listCampaigns() {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_campaigns ORDER BY created_at DESC`;
    return rows.map((row) => mapCampaign(row as Record<string, unknown>));
  }

  async createWeeklyPlan(input: Omit<WeeklyPlan, "createdAt">) {
    const sql = getSql();
    const rows = await sql`
      INSERT INTO marketing_weekly_plans (
        id, campaign_id, week_start, status, summary, rationale, is_demo
      ) VALUES (
        ${input.id}::uuid, ${input.campaignId}::uuid, ${input.weekStart},
        ${input.status}, ${json(input.summary)}::jsonb, ${json(input.rationale)}::jsonb,
        ${input.isDemo}
      )
      RETURNING *
    `;
    return mapPlan(rows[0] as Record<string, unknown>);
  }

  async updateWeeklyPlan(id: string, patch: Partial<WeeklyPlan>) {
    const current = await this.getWeeklyPlan(id);
    if (!current) return null;
    const next = { ...current, ...patch, id };
    const sql = getSql();
    const rows = await sql`
      UPDATE marketing_weekly_plans SET
        status = ${next.status},
        summary = ${json(next.summary)}::jsonb,
        rationale = ${json(next.rationale)}::jsonb
      WHERE id = ${id}::uuid
      RETURNING *
    `;
    return rows[0] ? mapPlan(rows[0] as Record<string, unknown>) : null;
  }

  async getWeeklyPlan(id: string) {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_weekly_plans WHERE id = ${id}::uuid LIMIT 1`;
    return rows[0] ? mapPlan(rows[0] as Record<string, unknown>) : null;
  }

  async listWeeklyPlans(campaignId?: string) {
    const sql = getSql();
    const rows = campaignId
      ? await sql`SELECT * FROM marketing_weekly_plans WHERE campaign_id = ${campaignId}::uuid ORDER BY week_start DESC`
      : await sql`SELECT * FROM marketing_weekly_plans ORDER BY week_start DESC`;
    return rows.map((row) => mapPlan(row as Record<string, unknown>));
  }

  async findWeeklyPlan(campaignId: string, weekStart: string) {
    const sql = getSql();
    const rows = await sql`
      SELECT * FROM marketing_weekly_plans
      WHERE campaign_id = ${campaignId}::uuid AND week_start = ${weekStart}
      LIMIT 1
    `;
    return rows[0] ? mapPlan(rows[0] as Record<string, unknown>) : null;
  }

  async createAsset(input: Omit<MarketingAsset, "createdAt">) {
    const sql = getSql();
    const rows = await sql`
      INSERT INTO marketing_assets (
        id, name, type, source, book_id, character_id, campaign_id, approved,
        usage_restrictions, aspect_ratio, image_width, image_height, mime_type,
        tags, url, alt_text, is_demo
      ) VALUES (
        ${input.id}::uuid, ${input.name}, ${input.type}, ${input.source},
        ${input.bookId}, ${input.characterId}, ${input.campaignId}::uuid,
        ${input.approved}, ${input.usageRestrictions}, ${input.aspectRatio},
        ${input.imageWidth ?? null}, ${input.imageHeight ?? null}, ${input.mimeType ?? null},
        ${json(input.tags)}::jsonb, ${input.url}, ${input.altText}, ${input.isDemo}
      )
      RETURNING *
    `;
    return mapAsset(rows[0] as Record<string, unknown>);
  }

  async updateAsset(id: string, patch: Partial<MarketingAsset>) {
    const sql = getSql();
    const current = await this.getAsset(id);
    if (!current) return null;
    const next = { ...current, ...patch, id };
    const rows = await sql`
      UPDATE marketing_assets SET
        name = ${next.name},
        type = ${next.type},
        source = ${next.source},
        book_id = ${next.bookId},
        character_id = ${next.characterId},
        campaign_id = ${next.campaignId}::uuid,
        approved = ${next.approved},
        usage_restrictions = ${next.usageRestrictions},
        aspect_ratio = ${next.aspectRatio},
        image_width = ${next.imageWidth ?? null},
        image_height = ${next.imageHeight ?? null},
        mime_type = ${next.mimeType ?? null},
        tags = ${json(next.tags)}::jsonb,
        url = ${next.url},
        alt_text = ${next.altText},
        is_demo = ${next.isDemo}
      WHERE id = ${id}::uuid
      RETURNING *
    `;
    return rows[0] ? mapAsset(rows[0] as Record<string, unknown>) : null;
  }

  async getAsset(id: string) {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_assets WHERE id = ${id}::uuid LIMIT 1`;
    return rows[0] ? mapAsset(rows[0] as Record<string, unknown>) : null;
  }

  async listAssets() {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_assets ORDER BY created_at DESC`;
    return rows.map((row) => mapAsset(row as Record<string, unknown>));
  }

  async createTemplate(input: Omit<MarketingTemplate, "createdAt">) {
    const sql = getSql();
    const rows = await sql`
      INSERT INTO marketing_templates (id, name, category, platform, structure, active)
      VALUES (
        ${input.id}::uuid, ${input.name}, ${input.category}, ${input.platform},
        ${json(input.structure)}::jsonb, ${input.active}
      )
      RETURNING *
    `;
    return mapTemplate(rows[0] as Record<string, unknown>);
  }

  async listTemplates() {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_templates ORDER BY created_at`;
    return rows.map((row) => mapTemplate(row as Record<string, unknown>));
  }

  async createContent(input: Omit<MarketingContent, "createdAt" | "updatedAt">) {
    const sql = getSql();
    const rows = await sql`
      INSERT INTO marketing_content (
        id, campaign_id, weekly_plan_id, platform, format, category, audience,
        status, title, body, cta, seo_title, seo_description, scheduled_for,
        timezone, asset_ids, needs_new_asset, warnings, safety_flags,
        tracking_token, original_body, book_id, is_demo
      ) VALUES (
        ${input.id}::uuid, ${input.campaignId}::uuid, ${input.weeklyPlanId}::uuid,
        ${input.platform}, ${input.format}, ${input.category}, ${input.audience},
        ${input.status}, ${input.title}, ${input.body}, ${input.cta},
        ${input.seoTitle}, ${input.seoDescription}, ${input.scheduledFor},
        ${input.timezone}, ${json(input.assetIds)}::jsonb, ${input.needsNewAsset},
        ${json(input.warnings)}::jsonb, ${json(input.safetyFlags)}::jsonb,
        ${input.trackingToken}, ${input.originalBody}, ${input.bookId}, ${input.isDemo}
      )
      RETURNING *
    `;
    return mapContent(rows[0] as Record<string, unknown>);
  }

  async updateContent(id: string, patch: Partial<MarketingContent>) {
    const current = await this.getContent(id);
    if (!current) return null;
    const next = { ...current, ...patch, id };
    const sql = getSql();
    const rows = await sql`
      UPDATE marketing_content SET
        status = ${next.status},
        title = ${next.title},
        body = ${next.body},
        cta = ${next.cta},
        seo_title = ${next.seoTitle},
        seo_description = ${next.seoDescription},
        scheduled_for = ${next.scheduledFor},
        timezone = ${next.timezone},
        asset_ids = ${json(next.assetIds)}::jsonb,
        needs_new_asset = ${next.needsNewAsset},
        warnings = ${json(next.warnings)}::jsonb,
        safety_flags = ${json(next.safetyFlags)}::jsonb,
        tracking_token = ${next.trackingToken},
        original_body = ${next.originalBody},
        updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING *
    `;
    return rows[0] ? mapContent(rows[0] as Record<string, unknown>) : null;
  }

  async getContent(id: string) {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_content WHERE id = ${id}::uuid LIMIT 1`;
    return rows[0] ? mapContent(rows[0] as Record<string, unknown>) : null;
  }

  async getContentByToken(token: string) {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_content WHERE tracking_token = ${token} LIMIT 1`;
    return rows[0] ? mapContent(rows[0] as Record<string, unknown>) : null;
  }

  async listContent(filters?: ContentFilters) {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_content ORDER BY created_at DESC LIMIT 500`;
    const mapped = rows.map((row) => mapContent(row as Record<string, unknown>));
    if (!filters) return mapped;
    return mapped.filter((item) => {
      if (filters.campaignId && item.campaignId !== filters.campaignId) return false;
      if (filters.weeklyPlanId && item.weeklyPlanId !== filters.weeklyPlanId) return false;
      if (filters.platform && item.platform !== filters.platform) return false;
      if (filters.audience && item.audience !== filters.audience) return false;
      if (filters.category && item.category !== filters.category) return false;
      if (filters.status && item.status !== filters.status) return false;
      return true;
    });
  }

  async addApproval(input: Omit<MarketingApproval, "createdAt">) {
    const sql = getSql();
    const rows = await sql`
      INSERT INTO marketing_approvals (
        id, content_id, action, actor, feedback, previous_body, new_body, preference_signals
      ) VALUES (
        ${input.id}::uuid, ${input.contentId}::uuid, ${input.action}, ${input.actor},
        ${input.feedback}, ${input.previousBody}, ${input.newBody},
        ${json(input.preferenceSignals)}::jsonb
      )
      RETURNING *
    `;
    return mapApproval(rows[0] as Record<string, unknown>);
  }

  async listApprovals(contentId?: string) {
    const sql = getSql();
    const rows = contentId
      ? await sql`SELECT * FROM marketing_approvals WHERE content_id = ${contentId}::uuid ORDER BY created_at DESC`
      : await sql`SELECT * FROM marketing_approvals ORDER BY created_at DESC LIMIT 200`;
    return rows.map((row) => mapApproval(row as Record<string, unknown>));
  }

  async createPublication(input: Omit<MarketingPublication, "createdAt" | "updatedAt">) {
    const sql = getSql();
    const rows = await sql`
      INSERT INTO marketing_publications (
        id, content_id, campaign_id, platform, provider, status, idempotency_key,
        external_id, url, attempt_count, last_error, scheduled_for, published_at
      ) VALUES (
        ${input.id}::uuid, ${input.contentId}::uuid, ${input.campaignId}::uuid,
        ${input.platform}, ${input.provider}, ${input.status}, ${input.idempotencyKey},
        ${input.externalId}, ${input.url}, ${input.attemptCount}, ${input.lastError},
        ${input.scheduledFor}, ${input.publishedAt}
      )
      ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = marketing_publications.updated_at
      RETURNING *
    `;
    return mapPublication(rows[0] as Record<string, unknown>);
  }

  async updatePublication(id: string, patch: Partial<MarketingPublication>) {
    const current = await this.getPublication(id);
    if (!current) return null;
    const next = { ...current, ...patch, id };
    const sql = getSql();
    const rows = await sql`
      UPDATE marketing_publications SET
        status = ${next.status},
        external_id = ${next.externalId},
        url = ${next.url},
        attempt_count = ${next.attemptCount},
        last_error = ${next.lastError},
        scheduled_for = ${next.scheduledFor},
        published_at = ${next.publishedAt},
        updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING *
    `;
    return rows[0] ? mapPublication(rows[0] as Record<string, unknown>) : null;
  }

  async getPublication(id: string) {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_publications WHERE id = ${id}::uuid LIMIT 1`;
    return rows[0] ? mapPublication(rows[0] as Record<string, unknown>) : null;
  }

  async getPublicationByIdempotency(key: string) {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_publications WHERE idempotency_key = ${key} LIMIT 1`;
    return rows[0] ? mapPublication(rows[0] as Record<string, unknown>) : null;
  }

  async listPublications(status?: MarketingPublication["status"]) {
    const sql = getSql();
    const rows = status
      ? await sql`SELECT * FROM marketing_publications WHERE status = ${status} ORDER BY created_at DESC`
      : await sql`SELECT * FROM marketing_publications ORDER BY created_at DESC LIMIT 300`;
    return rows.map((row) => mapPublication(row as Record<string, unknown>));
  }

  async claimPublication(id: string, options?: { allowExhaustedRetry?: boolean }) {
    const sql = getSql();
    const allowExhaustedRetry = Boolean(options?.allowExhaustedRetry);
    const rows = await sql`
      UPDATE marketing_publications
      SET status = 'processing', updated_at = now()
      WHERE id = ${id}::uuid
        AND (
          status = 'scheduled'
          OR (status = 'failed' AND (attempt_count < 3 OR ${allowExhaustedRetry}))
          OR (status = 'processing' AND updated_at < now() - interval '15 minutes')
        )
      RETURNING *
    `;
    return rows[0] ? mapPublication(rows[0] as Record<string, unknown>) : null;
  }

  async upsertMetric(input: Omit<MarketingMetric, "createdAt">) {
    const sql = getSql();
    const rows = await sql`
      INSERT INTO marketing_metrics (
        id, content_id, campaign_id, platform, metric_date, impressions, engagements,
        clicks, email_opens, email_clicks, website_sessions, book_page_views,
        attributed_purchases, source
      ) VALUES (
        ${input.id}::uuid, ${input.contentId}::uuid, ${input.campaignId}::uuid,
        ${input.platform}, ${input.metricDate}, ${input.impressions}, ${input.engagements},
        ${input.clicks}, ${input.emailOpens}, ${input.emailClicks}, ${input.websiteSessions},
        ${input.bookPageViews}, ${input.attributedPurchases}, ${input.source}
      )
      ON CONFLICT (content_id, metric_date, source) WHERE content_id IS NOT NULL
      DO UPDATE SET
        campaign_id = EXCLUDED.campaign_id,
        platform = EXCLUDED.platform,
        impressions = EXCLUDED.impressions,
        engagements = EXCLUDED.engagements,
        clicks = EXCLUDED.clicks,
        email_opens = EXCLUDED.email_opens,
        email_clicks = EXCLUDED.email_clicks,
        website_sessions = EXCLUDED.website_sessions,
        book_page_views = EXCLUDED.book_page_views,
        attributed_purchases = EXCLUDED.attributed_purchases
      RETURNING *
    `;
    return mapMetric(rows[0] as Record<string, unknown>);
  }

  async listMetrics(campaignId?: string) {
    const sql = getSql();
    const rows = campaignId
      ? await sql`SELECT * FROM marketing_metrics WHERE campaign_id = ${campaignId}::uuid ORDER BY metric_date DESC`
      : await sql`SELECT * FROM marketing_metrics ORDER BY metric_date DESC LIMIT 400`;
    return rows.map((row) => mapMetric(row as Record<string, unknown>));
  }

  async addPreference(input: Omit<MarketingPreference, "createdAt">) {
    const sql = getSql();
    const rows = await sql`
      INSERT INTO marketing_preferences (
        id, category, statement, source, strength, active, owner_confirmed
      ) VALUES (
        ${input.id}::uuid, ${input.category}, ${input.statement}, ${input.source},
        ${input.strength}, ${input.active}, ${input.ownerConfirmed}
      )
      RETURNING *
    `;
    return mapPreference(rows[0] as Record<string, unknown>);
  }

  async listPreferences() {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_preferences ORDER BY created_at DESC`;
    return rows.map((row) => mapPreference(row as Record<string, unknown>));
  }

  async addRule(input: Omit<MarketingRule, "createdAt">) {
    const sql = getSql();
    const rows = await sql`
      INSERT INTO marketing_rules (id, kind, title, body, book_id, active, origin)
      VALUES (
        ${input.id}::uuid, ${input.kind}, ${input.title}, ${input.body},
        ${input.bookId}, ${input.active}, ${input.origin}
      )
      RETURNING *
    `;
    return mapRule(rows[0] as Record<string, unknown>);
  }

  async listRules() {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_rules ORDER BY created_at`;
    return rows.map((row) => mapRule(row as Record<string, unknown>));
  }

  async createRecommendation(input: Omit<MarketingRecommendation, "createdAt">) {
    const sql = getSql();
    const rows = await sql`
      INSERT INTO marketing_recommendations (
        id, campaign_id, title, recommendation, reason, supporting_data,
        evidence_strength, status, decided_at
      ) VALUES (
        ${input.id}::uuid, ${input.campaignId}::uuid, ${input.title},
        ${input.recommendation}, ${input.reason}, ${json(input.supportingData)}::jsonb,
        ${input.evidenceStrength}, ${input.status}, ${input.decidedAt}
      )
      RETURNING *
    `;
    return mapRecommendation(rows[0] as Record<string, unknown>);
  }

  async updateRecommendation(id: string, patch: Partial<MarketingRecommendation>) {
    const current = (await this.listRecommendations()).find((item) => item.id === id);
    if (!current) return null;
    const next = { ...current, ...patch, id };
    const sql = getSql();
    const rows = await sql`
      UPDATE marketing_recommendations SET
        status = ${next.status},
        decided_at = ${next.decidedAt}
      WHERE id = ${id}::uuid
      RETURNING *
    `;
    return rows[0] ? mapRecommendation(rows[0] as Record<string, unknown>) : null;
  }

  async listRecommendations() {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_recommendations ORDER BY created_at DESC`;
    return rows.map((row) => mapRecommendation(row as Record<string, unknown>));
  }

  async logOperation(input: Omit<MarketingOperation, "createdAt">) {
    const sql = getSql();
    const rows = await sql`
      INSERT INTO marketing_operations (
        id, operation, provider, model_or_service, estimated_cost_usd, campaign_id,
        content_id, success, duration_ms, metadata
      ) VALUES (
        ${input.id}::uuid, ${input.operation}, ${input.provider}, ${input.modelOrService},
        ${input.estimatedCostUsd}, ${input.campaignId}::uuid, ${input.contentId}::uuid,
        ${input.success}, ${input.durationMs}, ${json(input.metadata)}::jsonb
      )
      RETURNING *
    `;
    return mapOperation(rows[0] as Record<string, unknown>);
  }

  async listOperations() {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_operations ORDER BY created_at DESC LIMIT 300`;
    return rows.map((row) => mapOperation(row as Record<string, unknown>));
  }

  async recordEvent(input: Omit<MarketingEvent, "createdAt">) {
    const sql = getSql();
    const rows = await sql`
      INSERT INTO marketing_events (id, name, campaign_id, content_id, platform, properties)
      VALUES (
        ${input.id}::uuid, ${input.name}, ${input.campaignId}::uuid, ${input.contentId}::uuid,
        ${input.platform}, ${json(input.properties)}::jsonb
      )
      RETURNING *
    `;
    return mapEvent(rows[0] as Record<string, unknown>);
  }

  async listEvents() {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_events ORDER BY created_at DESC LIMIT 400`;
    return rows.map((row) => mapEvent(row as Record<string, unknown>));
  }

  async recordClick(input: Omit<MarketingClick, "id" | "clickedAt"> & { id?: string }) {
    const sql = getSql();
    const id = input.id ?? crypto.randomUUID();
    const rows = await sql`
      INSERT INTO marketing_clicks (id, token, content_id, campaign_id, book_id, destination_path)
      VALUES (
        ${id}::uuid, ${input.token}, ${input.contentId}::uuid, ${input.campaignId}::uuid,
        ${input.bookId}, ${input.destinationPath}
      )
      RETURNING *
    `;
    return mapClick(rows[0] as Record<string, unknown>);
  }

  async listClicks() {
    const sql = getSql();
    const rows = await sql`SELECT * FROM marketing_clicks ORDER BY clicked_at DESC LIMIT 400`;
    return rows.map((row) => mapClick(row as Record<string, unknown>));
  }

  async getSetting<T>(key: string, fallback: T) {
    const sql = getSql();
    const rows = await sql`SELECT value FROM marketing_settings WHERE key = ${key} LIMIT 1`;
    if (!rows[0]) return fallback;
    return (rows[0] as { value: T }).value ?? fallback;
  }

  async setSetting(key: string, value: unknown) {
    const sql = getSql();
    await sql`
      INSERT INTO marketing_settings (key, value, updated_at)
      VALUES (${key}, ${json(value)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `;
  }
}
