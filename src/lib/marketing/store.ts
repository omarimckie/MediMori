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

export type MarketingStore = {
  createCampaign(
    input: Omit<MarketingCampaign, "createdAt" | "updatedAt">,
  ): Promise<MarketingCampaign>;
  updateCampaign(
    id: string,
    patch: Partial<MarketingCampaign>,
  ): Promise<MarketingCampaign | null>;
  getCampaign(id: string): Promise<MarketingCampaign | null>;
  listCampaigns(): Promise<MarketingCampaign[]>;

  createWeeklyPlan(input: Omit<WeeklyPlan, "createdAt">): Promise<WeeklyPlan>;
  updateWeeklyPlan(id: string, patch: Partial<WeeklyPlan>): Promise<WeeklyPlan | null>;
  getWeeklyPlan(id: string): Promise<WeeklyPlan | null>;
  listWeeklyPlans(campaignId?: string): Promise<WeeklyPlan[]>;
  findWeeklyPlan(campaignId: string, weekStart: string): Promise<WeeklyPlan | null>;

  createAsset(input: Omit<MarketingAsset, "createdAt">): Promise<MarketingAsset>;
  updateAsset(
    id: string,
    patch: Partial<MarketingAsset>,
  ): Promise<MarketingAsset | null>;
  getAsset(id: string): Promise<MarketingAsset | null>;
  listAssets(): Promise<MarketingAsset[]>;

  createTemplate(input: Omit<MarketingTemplate, "createdAt">): Promise<MarketingTemplate>;
  listTemplates(): Promise<MarketingTemplate[]>;

  createContent(
    input: Omit<MarketingContent, "createdAt" | "updatedAt">,
  ): Promise<MarketingContent>;
  updateContent(
    id: string,
    patch: Partial<MarketingContent>,
  ): Promise<MarketingContent | null>;
  getContent(id: string): Promise<MarketingContent | null>;
  getContentByToken(token: string): Promise<MarketingContent | null>;
  listContent(filters?: ContentFilters): Promise<MarketingContent[]>;

  addApproval(input: Omit<MarketingApproval, "createdAt">): Promise<MarketingApproval>;
  listApprovals(contentId?: string): Promise<MarketingApproval[]>;

  createPublication(
    input: Omit<MarketingPublication, "createdAt" | "updatedAt">,
  ): Promise<MarketingPublication>;
  updatePublication(
    id: string,
    patch: Partial<MarketingPublication>,
  ): Promise<MarketingPublication | null>;
  getPublication(id: string): Promise<MarketingPublication | null>;
  getPublicationByIdempotency(
    key: string,
  ): Promise<MarketingPublication | null>;
  listPublications(status?: MarketingPublication["status"]): Promise<MarketingPublication[]>;
  claimPublication(id: string): Promise<MarketingPublication | null>;

  upsertMetric(input: Omit<MarketingMetric, "createdAt">): Promise<MarketingMetric>;
  listMetrics(campaignId?: string): Promise<MarketingMetric[]>;

  addPreference(
    input: Omit<MarketingPreference, "createdAt">,
  ): Promise<MarketingPreference>;
  listPreferences(): Promise<MarketingPreference[]>;

  addRule(input: Omit<MarketingRule, "createdAt">): Promise<MarketingRule>;
  listRules(): Promise<MarketingRule[]>;

  createRecommendation(
    input: Omit<MarketingRecommendation, "createdAt">,
  ): Promise<MarketingRecommendation>;
  updateRecommendation(
    id: string,
    patch: Partial<MarketingRecommendation>,
  ): Promise<MarketingRecommendation | null>;
  listRecommendations(): Promise<MarketingRecommendation[]>;

  logOperation(
    input: Omit<MarketingOperation, "createdAt">,
  ): Promise<MarketingOperation>;
  listOperations(): Promise<MarketingOperation[]>;

  recordEvent(input: Omit<MarketingEvent, "createdAt">): Promise<MarketingEvent>;
  listEvents(): Promise<MarketingEvent[]>;

  recordClick(input: Omit<MarketingClick, "id" | "clickedAt"> & { id?: string }): Promise<MarketingClick>;
  listClicks(): Promise<MarketingClick[]>;

  getSetting<T>(key: string, fallback: T): Promise<T>;
  setSetting(key: string, value: unknown): Promise<void>;
};
