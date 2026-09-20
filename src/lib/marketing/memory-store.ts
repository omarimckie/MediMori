import { asBoolean, asNumber, asRecord, asString, asStringArray, asStringOrNull, toDateOnly, toIso } from "./json";
import type { MarketingStore } from "./store";
import type {
  AudienceId,
  CampaignStatus,
  ContentCategory,
  ContentFilters,
  ContentFormat,
  ContentStatus,
  EvidenceStrength,
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
  Platform,
  WeeklyPlan,
} from "./types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nowIso() {
  return new Date().toISOString();
}

function matchesFilters(item: MarketingContent, filters?: ContentFilters) {
  if (!filters) return true;
  if (filters.campaignId && item.campaignId !== filters.campaignId) return false;
  if (filters.weeklyPlanId && item.weeklyPlanId !== filters.weeklyPlanId) return false;
  if (filters.platform && item.platform !== filters.platform) return false;
  if (filters.audience && item.audience !== filters.audience) return false;
  if (filters.category && item.category !== filters.category) return false;
  if (filters.status && item.status !== filters.status) return false;
  return true;
}

export class MemoryMarketingStore implements MarketingStore {
  campaigns = new Map<string, MarketingCampaign>();
  plans = new Map<string, WeeklyPlan>();
  assets = new Map<string, MarketingAsset>();
  templates = new Map<string, MarketingTemplate>();
  content = new Map<string, MarketingContent>();
  approvals = new Map<string, MarketingApproval>();
  publications = new Map<string, MarketingPublication>();
  metrics = new Map<string, MarketingMetric>();
  preferences = new Map<string, MarketingPreference>();
  rules = new Map<string, MarketingRule>();
  recommendations = new Map<string, MarketingRecommendation>();
  operations = new Map<string, MarketingOperation>();
  events = new Map<string, MarketingEvent>();
  clicks = new Map<string, MarketingClick>();
  settings = new Map<string, unknown>();

  async createCampaign(input: Omit<MarketingCampaign, "createdAt" | "updatedAt">) {
    const row: MarketingCampaign = { ...input, createdAt: nowIso(), updatedAt: nowIso() };
    this.campaigns.set(row.id, row);
    return clone(row);
  }

  async updateCampaign(id: string, patch: Partial<MarketingCampaign>) {
    const current = this.campaigns.get(id);
    if (!current) return null;
    const row = { ...current, ...patch, id, updatedAt: nowIso() };
    this.campaigns.set(id, row);
    return clone(row);
  }

  async getCampaign(id: string) {
    const row = this.campaigns.get(id);
    return row ? clone(row) : null;
  }

  async listCampaigns() {
    return [...this.campaigns.values()].map(clone).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createWeeklyPlan(input: Omit<WeeklyPlan, "createdAt">) {
    const row: WeeklyPlan = { ...input, createdAt: nowIso() };
    this.plans.set(row.id, row);
    return clone(row);
  }

  async updateWeeklyPlan(id: string, patch: Partial<WeeklyPlan>) {
    const current = this.plans.get(id);
    if (!current) return null;
    const row = { ...current, ...patch, id };
    this.plans.set(id, row);
    return clone(row);
  }

  async getWeeklyPlan(id: string) {
    const row = this.plans.get(id);
    return row ? clone(row) : null;
  }

  async listWeeklyPlans(campaignId?: string) {
    return [...this.plans.values()]
      .filter((plan) => !campaignId || plan.campaignId === campaignId)
      .map(clone)
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  }

  async findWeeklyPlan(campaignId: string, weekStart: string) {
    const row = [...this.plans.values()].find(
      (plan) => plan.campaignId === campaignId && plan.weekStart === weekStart,
    );
    return row ? clone(row) : null;
  }

  async createAsset(input: Omit<MarketingAsset, "createdAt">) {
    const row: MarketingAsset = { ...input, createdAt: nowIso() };
    this.assets.set(row.id, row);
    return clone(row);
  }

  async updateAsset(id: string, patch: Partial<MarketingAsset>) {
    const current = this.assets.get(id);
    if (!current) return null;
    const row = { ...current, ...patch, id, createdAt: current.createdAt };
    this.assets.set(id, row);
    return clone(row);
  }

  async getAsset(id: string) {
    const row = this.assets.get(id);
    return row ? clone(row) : null;
  }

  async listAssets() {
    return [...this.assets.values()].map(clone);
  }

  async createTemplate(input: Omit<MarketingTemplate, "createdAt">) {
    const row: MarketingTemplate = { ...input, createdAt: nowIso() };
    this.templates.set(row.id, row);
    return clone(row);
  }

  async listTemplates() {
    return [...this.templates.values()].map(clone);
  }

  async createContent(input: Omit<MarketingContent, "createdAt" | "updatedAt">) {
    const row: MarketingContent = { ...input, createdAt: nowIso(), updatedAt: nowIso() };
    this.content.set(row.id, row);
    return clone(row);
  }

  async updateContent(id: string, patch: Partial<MarketingContent>) {
    const current = this.content.get(id);
    if (!current) return null;
    const row = { ...current, ...patch, id, updatedAt: nowIso() };
    this.content.set(id, row);
    return clone(row);
  }

  async getContent(id: string) {
    const row = this.content.get(id);
    return row ? clone(row) : null;
  }

  async getContentByToken(token: string) {
    const row = [...this.content.values()].find((item) => item.trackingToken === token);
    return row ? clone(row) : null;
  }

  async listContent(filters?: ContentFilters) {
    return [...this.content.values()]
      .filter((item) => matchesFilters(item, filters))
      .map(clone)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async addApproval(input: Omit<MarketingApproval, "createdAt">) {
    const row: MarketingApproval = { ...input, createdAt: nowIso() };
    this.approvals.set(row.id, row);
    return clone(row);
  }

  async listApprovals(contentId?: string) {
    return [...this.approvals.values()]
      .filter((item) => !contentId || item.contentId === contentId)
      .map(clone);
  }

  async createPublication(input: Omit<MarketingPublication, "createdAt" | "updatedAt">) {
    const row: MarketingPublication = { ...input, createdAt: nowIso(), updatedAt: nowIso() };
    this.publications.set(row.id, row);
    return clone(row);
  }

  async updatePublication(id: string, patch: Partial<MarketingPublication>) {
    const current = this.publications.get(id);
    if (!current) return null;
    const row = { ...current, ...patch, id, updatedAt: nowIso() };
    this.publications.set(id, row);
    return clone(row);
  }

  async getPublication(id: string) {
    const row = this.publications.get(id);
    return row ? clone(row) : null;
  }

  async getPublicationByIdempotency(key: string) {
    const row = [...this.publications.values()].find((item) => item.idempotencyKey === key);
    return row ? clone(row) : null;
  }

  async listPublications(status?: MarketingPublication["status"]) {
    return [...this.publications.values()]
      .filter((item) => !status || item.status === status)
      .map(clone);
  }

  async claimPublication(id: string) {
    const current = this.publications.get(id);
    if (!current) return null;
    const staleMs = 15 * 60 * 1000;
    const updatedAt = new Date(current.updatedAt).getTime();
    const claimable =
      current.status === "scheduled" ||
      (current.status === "failed" && current.attemptCount < 3) ||
      (current.status === "processing" && Date.now() - updatedAt >= staleMs);
    if (!claimable) return null;
    const row: MarketingPublication = {
      ...current,
      status: "processing",
      updatedAt: nowIso(),
    };
    this.publications.set(id, row);
    return clone(row);
  }

  async upsertMetric(input: Omit<MarketingMetric, "createdAt">) {
    const existing = [...this.metrics.values()].find(
      (item) =>
        item.contentId &&
        item.contentId === input.contentId &&
        item.metricDate === input.metricDate &&
        item.source === input.source,
    );
    const row: MarketingMetric = existing
      ? { ...existing, ...input, id: existing.id, createdAt: existing.createdAt }
      : { ...input, createdAt: nowIso() };
    this.metrics.set(row.id, row);
    return clone(row);
  }

  async listMetrics(campaignId?: string) {
    return [...this.metrics.values()]
      .filter((item) => !campaignId || item.campaignId === campaignId)
      .map(clone);
  }

  async addPreference(input: Omit<MarketingPreference, "createdAt">) {
    const row: MarketingPreference = { ...input, createdAt: nowIso() };
    this.preferences.set(row.id, row);
    return clone(row);
  }

  async listPreferences() {
    return [...this.preferences.values()].map(clone);
  }

  async addRule(input: Omit<MarketingRule, "createdAt">) {
    const row: MarketingRule = { ...input, createdAt: nowIso() };
    this.rules.set(row.id, row);
    return clone(row);
  }

  async listRules() {
    return [...this.rules.values()].map(clone);
  }

  async createRecommendation(input: Omit<MarketingRecommendation, "createdAt">) {
    const row: MarketingRecommendation = { ...input, createdAt: nowIso() };
    this.recommendations.set(row.id, row);
    return clone(row);
  }

  async updateRecommendation(id: string, patch: Partial<MarketingRecommendation>) {
    const current = this.recommendations.get(id);
    if (!current) return null;
    const row = { ...current, ...patch, id };
    this.recommendations.set(id, row);
    return clone(row);
  }

  async listRecommendations() {
    return [...this.recommendations.values()].map(clone);
  }

  async logOperation(input: Omit<MarketingOperation, "createdAt">) {
    const row: MarketingOperation = { ...input, createdAt: nowIso() };
    this.operations.set(row.id, row);
    return clone(row);
  }

  async listOperations() {
    return [...this.operations.values()].map(clone).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async recordEvent(input: Omit<MarketingEvent, "createdAt">) {
    const row: MarketingEvent = { ...input, createdAt: nowIso() };
    this.events.set(row.id, row);
    return clone(row);
  }

  async listEvents() {
    return [...this.events.values()].map(clone);
  }

  async recordClick(input: Omit<MarketingClick, "id" | "clickedAt"> & { id?: string }) {
    const row: MarketingClick = {
      id: input.id ?? crypto.randomUUID(),
      token: input.token,
      contentId: input.contentId,
      campaignId: input.campaignId,
      bookId: input.bookId,
      destinationPath: input.destinationPath,
      clickedAt: nowIso(),
    };
    this.clicks.set(row.id, row);
    return clone(row);
  }

  async listClicks() {
    return [...this.clicks.values()].map(clone);
  }

  async getSetting<T>(key: string, fallback: T) {
    return (this.settings.has(key) ? (this.settings.get(key) as T) : fallback) as T;
  }

  async setSetting(key: string, value: unknown) {
    this.settings.set(key, value);
  }
}

export function mapCampaign(row: Record<string, unknown>): MarketingCampaign {
  return {
    id: asString(row.id),
    name: asString(row.name),
    objective: asString(row.objective),
    status: asString(row.status, "planned") as CampaignStatus,
    primaryAudience: asString(row.primary_audience, "parents") as AudienceId,
    secondaryAudience: asStringOrNull(row.secondary_audience) as AudienceId | null,
    coreMessage: asString(row.core_message),
    contentThemes: asStringArray(row.content_themes),
    channelDistribution: asRecord(row.channel_distribution) as MarketingCampaign["channelDistribution"],
    recommendedFrequency: asRecord(row.recommended_frequency) as MarketingCampaign["recommendedFrequency"],
    cta: asStringOrNull(row.cta),
    requiredAssets: asStringArray(row.required_assets),
    measurementGoals: asStringArray(row.measurement_goals),
    bookIds: asStringArray(row.book_ids),
    startOn: toDateOnly(row.start_on),
    endOn: toDateOnly(row.end_on),
    createdBy: asStringOrNull(row.created_by),
    isDemo: asBoolean(row.is_demo),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function mapPlan(row: Record<string, unknown>): WeeklyPlan {
  const summary = asRecord(row.summary);
  return {
    id: asString(row.id),
    campaignId: asStringOrNull(row.campaign_id),
    weekStart: toDateOnly(row.week_start) ?? toIso(row.week_start).slice(0, 10),
    status: asString(row.status, "draft") as WeeklyPlan["status"],
    summary: {
      itemCount: asNumber(summary.itemCount),
      newAssetCount: asNumber(summary.newAssetCount),
      warningCount: asNumber(summary.warningCount),
      objective: asString(summary.objective),
      audience: asString(summary.audience),
      quotas: (summary.quotas ?? {}) as WeeklyPlan["summary"]["quotas"],
    },
    rationale: asRecord(row.rationale),
    isDemo: asBoolean(row.is_demo),
    createdAt: toIso(row.created_at),
  };
}

export function mapAsset(row: Record<string, unknown>): MarketingAsset {
  return {
    id: asString(row.id),
    name: asString(row.name),
    type: asString(row.type),
    source: asString(row.source),
    bookId: asStringOrNull(row.book_id),
    characterId: asStringOrNull(row.character_id),
    campaignId: asStringOrNull(row.campaign_id),
    approved: asBoolean(row.approved),
    usageRestrictions: asStringOrNull(row.usage_restrictions),
    aspectRatio: asStringOrNull(row.aspect_ratio),
    imageWidth: row.image_width != null ? asNumber(row.image_width) : null,
    imageHeight: row.image_height != null ? asNumber(row.image_height) : null,
    mimeType: asStringOrNull(row.mime_type),
    tags: asStringArray(row.tags),
    url: asStringOrNull(row.url),
    altText: asStringOrNull(row.alt_text),
    isDemo: asBoolean(row.is_demo),
    createdAt: toIso(row.created_at),
  };
}

export function mapTemplate(row: Record<string, unknown>): MarketingTemplate {
  return {
    id: asString(row.id),
    name: asString(row.name),
    category: asString(row.category) as ContentCategory,
    platform: asStringOrNull(row.platform) as Platform | null,
    structure: asRecord(row.structure) as MarketingTemplate["structure"],
    active: asBoolean(row.active, true),
    createdAt: toIso(row.created_at),
  };
}

export function mapContent(row: Record<string, unknown>): MarketingContent {
  return {
    id: asString(row.id),
    campaignId: asStringOrNull(row.campaign_id),
    weeklyPlanId: asStringOrNull(row.weekly_plan_id),
    platform: asString(row.platform) as Platform,
    format: asString(row.format) as ContentFormat,
    category: asString(row.category) as ContentCategory,
    audience: asString(row.audience, "parents") as AudienceId,
    status: asString(row.status, "draft") as ContentStatus,
    title: asStringOrNull(row.title),
    body: asString(row.body),
    cta: asStringOrNull(row.cta),
    seoTitle: asStringOrNull(row.seo_title),
    seoDescription: asStringOrNull(row.seo_description),
    scheduledFor: row.scheduled_for ? toIso(row.scheduled_for) : null,
    timezone: asString(row.timezone, "America/New_York"),
    assetIds: asStringArray(row.asset_ids),
    needsNewAsset: asBoolean(row.needs_new_asset),
    warnings: asStringArray(row.warnings),
    safetyFlags: (Array.isArray(row.safety_flags)
      ? row.safety_flags
      : asString(row.safety_flags)
        ? JSON.parse(asString(row.safety_flags))
        : []) as MarketingContent["safetyFlags"],
    trackingToken: asStringOrNull(row.tracking_token),
    originalBody: asStringOrNull(row.original_body),
    bookId: asStringOrNull(row.book_id),
    isDemo: asBoolean(row.is_demo),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function mapApproval(row: Record<string, unknown>): MarketingApproval {
  return {
    id: asString(row.id),
    contentId: asString(row.content_id),
    action: asString(row.action) as MarketingApproval["action"],
    actor: asStringOrNull(row.actor),
    feedback: asStringOrNull(row.feedback),
    previousBody: asStringOrNull(row.previous_body),
    newBody: asStringOrNull(row.new_body),
    preferenceSignals: (Array.isArray(row.preference_signals)
      ? row.preference_signals
      : []) as MarketingApproval["preferenceSignals"],
    createdAt: toIso(row.created_at),
  };
}

export function mapPublication(row: Record<string, unknown>): MarketingPublication {
  return {
    id: asString(row.id),
    contentId: asString(row.content_id),
    campaignId: asStringOrNull(row.campaign_id),
    platform: asString(row.platform) as Platform,
    provider: asString(row.provider),
    status: asString(row.status) as MarketingPublication["status"],
    idempotencyKey: asString(row.idempotency_key),
    externalId: asStringOrNull(row.external_id),
    url: asStringOrNull(row.url),
    attemptCount: asNumber(row.attempt_count),
    lastError: asStringOrNull(row.last_error),
    scheduledFor: row.scheduled_for ? toIso(row.scheduled_for) : null,
    publishedAt: row.published_at ? toIso(row.published_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function mapMetric(row: Record<string, unknown>): MarketingMetric {
  return {
    id: asString(row.id),
    contentId: asStringOrNull(row.content_id),
    campaignId: asStringOrNull(row.campaign_id),
    platform: asStringOrNull(row.platform) as Platform | null,
    metricDate: toDateOnly(row.metric_date) ?? toIso(row.metric_date).slice(0, 10),
    impressions: asNumber(row.impressions),
    engagements: asNumber(row.engagements),
    clicks: asNumber(row.clicks),
    emailOpens: asNumber(row.email_opens),
    emailClicks: asNumber(row.email_clicks),
    websiteSessions: asNumber(row.website_sessions),
    bookPageViews: asNumber(row.book_page_views),
    attributedPurchases: asNumber(row.attributed_purchases),
    source: asString(row.source, "mock") as MarketingMetric["source"],
    createdAt: toIso(row.created_at),
  };
}

export function mapPreference(row: Record<string, unknown>): MarketingPreference {
  return {
    id: asString(row.id),
    category: asString(row.category),
    statement: asString(row.statement),
    source: asString(row.source),
    strength: asString(row.strength, "signal") as MarketingPreference["strength"],
    active: asBoolean(row.active, true),
    ownerConfirmed: asBoolean(row.owner_confirmed),
    createdAt: toIso(row.created_at),
  };
}

export function mapRule(row: Record<string, unknown>): MarketingRule {
  return {
    id: asString(row.id),
    kind: asString(row.kind) as MarketingRule["kind"],
    title: asString(row.title),
    body: asString(row.body),
    bookId: asStringOrNull(row.book_id),
    active: asBoolean(row.active, true),
    origin: asString(row.origin, "seed") as MarketingRule["origin"],
    createdAt: toIso(row.created_at),
  };
}

export function mapRecommendation(row: Record<string, unknown>): MarketingRecommendation {
  return {
    id: asString(row.id),
    campaignId: asStringOrNull(row.campaign_id),
    title: asString(row.title),
    recommendation: asString(row.recommendation),
    reason: asString(row.reason),
    supportingData: asRecord(row.supporting_data),
    evidenceStrength: asString(row.evidence_strength, "limited") as EvidenceStrength,
    status: asString(row.status, "open") as MarketingRecommendation["status"],
    createdAt: toIso(row.created_at),
    decidedAt: row.decided_at ? toIso(row.decided_at) : null,
  };
}

export function mapOperation(row: Record<string, unknown>): MarketingOperation {
  return {
    id: asString(row.id),
    operation: asString(row.operation),
    provider: asString(row.provider),
    modelOrService: asStringOrNull(row.model_or_service),
    estimatedCostUsd: asNumber(row.estimated_cost_usd),
    campaignId: asStringOrNull(row.campaign_id),
    contentId: asStringOrNull(row.content_id),
    success: asBoolean(row.success, true),
    durationMs: row.duration_ms == null ? null : asNumber(row.duration_ms),
    metadata: asRecord(row.metadata),
    createdAt: toIso(row.created_at),
  };
}

export function mapEvent(row: Record<string, unknown>): MarketingEvent {
  return {
    id: asString(row.id),
    name: asString(row.name),
    campaignId: asStringOrNull(row.campaign_id),
    contentId: asStringOrNull(row.content_id),
    platform: asStringOrNull(row.platform) as Platform | null,
    properties: asRecord(row.properties),
    createdAt: toIso(row.created_at),
  };
}

export function mapClick(row: Record<string, unknown>): MarketingClick {
  return {
    id: asString(row.id),
    token: asString(row.token),
    contentId: asStringOrNull(row.content_id),
    campaignId: asStringOrNull(row.campaign_id),
    bookId: asStringOrNull(row.book_id),
    destinationPath: asString(row.destination_path),
    clickedAt: toIso(row.clicked_at),
  };
}
