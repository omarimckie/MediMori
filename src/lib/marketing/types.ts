export const CONTENT_STATUSES = [
  "draft",
  "needs_review",
  "approved",
  "rejected",
  "scheduled",
  "published",
  "failed",
  "archived",
] as const;

export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CAMPAIGN_STATUSES = [
  "planned",
  "active",
  "completed",
  "archived",
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const PLATFORMS = [
  "instagram",
  "facebook",
  "pinterest",
  "email",
  "website",
  "google",
] as const;

export type Platform = (typeof PLATFORMS)[number];

export const CONTENT_FORMATS = [
  "post",
  "carousel",
  "reel_script",
  "story",
  "pin",
  "email",
  "article",
  "google_update",
  "seo_title",
  "seo_description",
  "cta",
] as const;

export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const CONTENT_CATEGORIES = [
  "educational",
  "brand_story",
  "product_feature",
  "engagement",
  "trust",
  "conversion",
  "community",
] as const;

export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export const AUDIENCES = [
  "parents",
  "hospitals",
  "schools",
  "libraries",
] as const;

export type AudienceId = (typeof AUDIENCES)[number];

export const ATTRIBUTION_KINDS = [
  "directly_attributed",
  "assisted",
  "unattributed",
] as const;

export type AttributionKind = (typeof ATTRIBUTION_KINDS)[number];

export const EVIDENCE_STRENGTHS = ["limited", "supporting", "strong"] as const;
export type EvidenceStrength = (typeof EVIDENCE_STRENGTHS)[number];

export type ChannelQuotas = Record<Platform, number>;

export type SafetyFlag = {
  code: string;
  message: string;
  severity: "warning" | "review_required";
};

export type PreferenceSignal = {
  category: string;
  statement: string;
  strength: "signal" | "supporting" | "owner_confirmed";
};

export type MarketingCampaign = {
  id: string;
  name: string;
  objective: string;
  status: CampaignStatus;
  primaryAudience: AudienceId;
  secondaryAudience: AudienceId | null;
  coreMessage: string;
  contentThemes: string[];
  channelDistribution: Partial<Record<Platform, number>>;
  recommendedFrequency: Partial<Record<Platform, string>>;
  cta: string | null;
  requiredAssets: string[];
  measurementGoals: string[];
  bookIds: string[];
  startOn: string | null;
  endOn: string | null;
  createdBy: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WeeklyPlan = {
  id: string;
  campaignId: string | null;
  weekStart: string;
  status: "draft" | "ready" | "approved" | "published";
  summary: {
    itemCount: number;
    newAssetCount: number;
    warningCount: number;
    objective: string;
    audience: string;
    quotas: ChannelQuotas;
  };
  rationale: Record<string, unknown>;
  isDemo: boolean;
  createdAt: string;
};

export type MarketingAsset = {
  id: string;
  name: string;
  type: string;
  source: string;
  bookId: string | null;
  characterId: string | null;
  campaignId: string | null;
  approved: boolean;
  usageRestrictions: string | null;
  aspectRatio: string | null;
  tags: string[];
  url: string | null;
  altText: string | null;
  isDemo: boolean;
  createdAt: string;
};

export type MarketingTemplate = {
  id: string;
  name: string;
  category: ContentCategory;
  platform: Platform | null;
  structure: {
    hook?: string;
    bodyGuidance: string;
    ctaGuidance?: string;
    notes?: string;
  };
  active: boolean;
  createdAt: string;
};

export type MarketingContent = {
  id: string;
  campaignId: string | null;
  weeklyPlanId: string | null;
  platform: Platform;
  format: ContentFormat;
  category: ContentCategory;
  audience: AudienceId;
  status: ContentStatus;
  title: string | null;
  body: string;
  cta: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  scheduledFor: string | null;
  timezone: string;
  assetIds: string[];
  needsNewAsset: boolean;
  warnings: string[];
  safetyFlags: SafetyFlag[];
  trackingToken: string | null;
  originalBody: string | null;
  bookId: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MarketingApproval = {
  id: string;
  contentId: string;
  action:
    | "approve"
    | "reject"
    | "edit"
    | "regenerate"
    | "feedback"
    | "approve_all"
    | "reject_all";
  actor: string | null;
  feedback: string | null;
  previousBody: string | null;
  newBody: string | null;
  preferenceSignals: PreferenceSignal[];
  createdAt: string;
};

export type MarketingPublication = {
  id: string;
  contentId: string;
  campaignId: string | null;
  platform: Platform;
  provider: string;
  status: "queued" | "scheduled" | "processing" | "published" | "failed";
  idempotencyKey: string;
  externalId: string | null;
  url: string | null;
  attemptCount: number;
  lastError: string | null;
  scheduledFor: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MarketingMetric = {
  id: string;
  contentId: string | null;
  campaignId: string | null;
  platform: Platform | null;
  metricDate: string;
  impressions: number;
  engagements: number;
  clicks: number;
  emailOpens: number;
  emailClicks: number;
  websiteSessions: number;
  bookPageViews: number;
  attributedPurchases: number;
  source: "mock" | "platform" | "website";
  createdAt: string;
};

export type MarketingPreference = {
  id: string;
  category: string;
  statement: string;
  source: string;
  strength: "signal" | "supporting" | "owner_confirmed";
  active: boolean;
  ownerConfirmed: boolean;
  createdAt: string;
};

export type MarketingRule = {
  id: string;
  kind:
    | "approved_claim"
    | "restricted_claim"
    | "cta"
    | "promo"
    | "asset"
    | "quota"
    | "playbook";
  title: string;
  body: string;
  bookId: string | null;
  active: boolean;
  origin: "seed" | "owner" | "system";
  createdAt: string;
};

export type MarketingRecommendation = {
  id: string;
  campaignId: string | null;
  title: string;
  recommendation: string;
  reason: string;
  supportingData: Record<string, unknown>;
  evidenceStrength: EvidenceStrength;
  status: "open" | "accepted" | "rejected" | "dismissed";
  createdAt: string;
  decidedAt: string | null;
};

export type MarketingOperation = {
  id: string;
  operation: string;
  provider: string;
  modelOrService: string | null;
  estimatedCostUsd: number;
  campaignId: string | null;
  contentId: string | null;
  success: boolean;
  durationMs: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type MarketingEvent = {
  id: string;
  name: string;
  campaignId: string | null;
  contentId: string | null;
  platform: Platform | null;
  properties: Record<string, unknown>;
  createdAt: string;
};

export type MarketingClick = {
  id: string;
  token: string;
  contentId: string | null;
  campaignId: string | null;
  bookId: string | null;
  destinationPath: string;
  clickedAt: string;
};

export type ContentFilters = {
  campaignId?: string;
  weeklyPlanId?: string;
  platform?: Platform;
  audience?: AudienceId;
  category?: ContentCategory;
  status?: ContentStatus;
};

export type PurchaseSnapshot = {
  id: string;
  bookId: string;
  purchasedAt: string;
  amountCents: number | null;
};
