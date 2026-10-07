export type MarketingPageGuideId =
  | "overview"
  | "week"
  | "report"
  | "smart-upload"
  | "campaigns"
  | "content"
  | "calendar"
  | "assets"
  | "analytics"
  | "recommendations"
  | "brain"
  | "costs"
  | "incidents";

export type MarketingPageGuideEntry = {
  id: MarketingPageGuideId;
  title: string;
  purpose: string;
  actions: string[];
  notes: string[];
};

export const MARKETING_PAGE_GUIDES: Record<MarketingPageGuideId, MarketingPageGuideEntry> = {
  overview: {
    id: "overview",
    title: "Overview",
    purpose:
      "High-level snapshot of Marketing Autopilot: campaign context, weekly plan readiness, content counts, and estimated operations cost.",
    actions: [
      "Check mock mode, counts, and whether a weekly package is ready for review.",
      "Open Your week when a plan is ready, or use Generate this week when a campaign exists.",
      "Jump to Campaigns or the content queue when something needs attention.",
    ],
    notes: [
      "Load demo seed only appears in non-production demo setups.",
      "Estimated ops cost here matches internal operation logs, not invoice-grade billing.",
    ],
  },
  week: {
    id: "week",
    title: "Your week",
    purpose:
      "Working queue for the marketing week you select: review generated or assigned posts, fix copy, and move items toward publication.",
    actions: [
      "Select the operational week, then review each item’s copy, warnings, and visuals.",
      "Approve posts, schedule them with a publish time, or upload assets when something needs a new image.",
      "Use Publish due only when you intend to run the dispatcher for posts that are already due.",
    ],
    notes: [
      "Scheduling sets when a post becomes due; the GitHub Actions dispatcher and cron job handle automatic publishing after that.",
      "Items can be removed from this working view without deleting content from the system.",
    ],
  },
  report: {
    id: "report",
    title: "Weekly report",
    purpose:
      "A generated summary of recent marketing activity: published counts, internal metric totals, purchases, and heuristic recommendations for the period.",
    actions: [
      "Open this page when you want the latest generated weekly snapshot (reload the page to refresh).",
      "Review top and underperforming items and purchase totals.",
      "Accept, reject, or dismiss report recommendations to record your decision.",
    ],
    notes: [
      "Engagement figures come from internal marketing metrics, not live Facebook or Instagram Insights.",
      "Accepting a recommendation records your choice; it does not automatically change plans, quotas, or content.",
    ],
  },
  "smart-upload": {
    id: "smart-upload",
    title: "Smart Upload",
    purpose:
      "Turn an existing creative (image) into platform-ready Content records with AI-assisted or manual captions.",
    actions: [
      "Upload and validate your creative, then run preview or caption generation as needed.",
      "Choose Shared or Per-platform captions, review Facebook and Instagram copy (hashtags apply to Instagram).",
      "Finalize when copy and image are correct to create Content records.",
    ],
    notes: [
      "Finalizing creates Content in the library; it does not publish to social channels by itself.",
      "Open Content or Your week next to assign the new items to a week and schedule them.",
    ],
  },
  campaigns: {
    id: "campaigns",
    title: "Campaigns",
    purpose:
      "Define campaign objectives so the planner can generate weekly packages using catalog books, approved claims, and channel quotas.",
    actions: [
      "Write a clear objective and create a campaign.",
      "Use Generate week on an active campaign, then open Your week to review the package.",
    ],
    notes: [
      "The planner does not invent medical facts; it relies on the marketing brain and approved claims.",
      "Generating a week does not schedule or publish posts—you still approve and schedule in Your week or Calendar.",
    ],
  },
  content: {
    id: "content",
    title: "Content",
    purpose:
      "Inventory and staging area for all marketing content records, including items from Smart Upload, campaigns, and manual flows.",
    actions: [
      "Filter by status, platform, category, or audience to find items.",
      "Add approved or draft items to an operational week with Add to week.",
      "Open Your week for review, approval, and scheduling when items are assigned.",
    ],
    notes: [
      "Being listed here does not mean a post is scheduled or published.",
      "Statuses reflect workflow stage; scheduled and published items are managed from Your week and Calendar too.",
    ],
  },
  calendar: {
    id: "calendar",
    title: "Calendar",
    purpose:
      "Month view of scheduled and published marketing activity in the marketing timezone.",
    actions: [
      "Browse by month to see what is planned or already went out.",
      "Open an event for details, or use Add existing post to schedule or recycle approved content onto the calendar.",
    ],
    notes: [
      "This is a time-oriented view; heavy editing and approval still happen in Your week.",
      "Scheduling from here sets due times the same way as Your week—the dispatcher publishes when due.",
    ],
  },
  assets: {
    id: "assets",
    title: "Assets",
    purpose:
      "Media inventory for marketing: manual uploads, free resources, and creatives tied to Smart Upload.",
    actions: [
      "Upload post images or free resources when a weekly plan exists to attach them to the campaign week.",
      "Edit or replace manual-upload assets; review status and metadata on each card.",
    ],
    notes: [
      "Manual-upload assets support more management actions than Smart Upload–originated assets.",
      "Smart Upload assets are not currently a picker for starting new Smart Upload sessions from this page.",
      "Campaign generation may use eligible approved assets, but this is not yet a full reusable operator media library.",
    ],
  },
  analytics: {
    id: "analytics",
    title: "Analytics",
    purpose:
      "Internal marketing metrics, tracked-link clicks, and purchase attribution tied to marketing activity.",
    actions: [
      "Review rolled-up impressions, engagements, clicks, sessions, and book page views from stored metrics.",
      "Inspect purchase attribution and recent tracked clicks.",
    ],
    notes: [
      "This does not ingest live Facebook or Instagram Meta Insights (likes, comments, reach, saves, shares, etc.).",
      "Impressions and engagements shown here are not live Meta performance data.",
      "Full website behavioral analytics (complete visitor journeys) is not implemented.",
      "The publish-due control on this page only triggers the dispatcher; it does not change how metrics are collected.",
    ],
  },
  recommendations: {
    id: "recommendations",
    title: "Recommendations",
    purpose:
      "Rule- and heuristic-based suggestions generated from internal data; a place to review and record decisions.",
    actions: [
      "Generate a fresh batch when you want updated suggestions.",
      "Accept, reject, or dismiss each item to log your decision.",
    ],
    notes: [
      "Recommendations are deterministic/heuristic—not automatic learning from live Meta performance.",
      "Accepting a recommendation does not automatically change plans, quotas, strategy, or create content.",
    ],
  },
  brain: {
    id: "brain",
    title: "Marketing brain",
    purpose:
      "Reference view of brand voice, books, audiences, characters, approved and restricted claims, preferences, and templates used by generation and planning.",
    actions: [
      "Read this when you need to confirm what the system is allowed to say and who it is speaking to.",
      "Cross-check campaign or caption output against approved claims and promotional rules.",
    ],
    notes: [
      "Underlying brain data is actively consumed by generation, planning, and safety checks in code.",
      "This UI is primarily read-only—you cannot edit the full strategy from this page alone.",
    ],
  },
  incidents: {
    id: "incidents",
    title: "Incidents",
    purpose:
      "Operational record of publication and reliability problems that may need owner investigation—not publication authorization.",
    actions: [
      "Review unresolved incidents and open a record for summary, safety context, evidence, and history.",
      "Move incidents through operational statuses (investigating, needs action, blocked) while you work.",
      "Resolve with a short summary when handling is complete; resolving closes the incident only.",
    ],
    notes: [
      "Resolve does not fix a publication, clear ambiguity, enable retry, or call Meta.",
      "Retry safety and permitted actions are informational snapshots from when the incident was recorded.",
      "If the same condition is genuinely observed again after resolve, the system may reopen the same incident automatically.",
      "Consider direct push → incident deep-linking for incident-linked notifications after III-A3.",
    ],
  },
  costs: {
    id: "costs",
    title: "Costs",
    purpose:
      "Estimated costs from persisted marketing operation logs (AI and other logged marketing operations).",
    actions: [
      "Scan the running total and per-operation lines to understand where spend is accruing.",
      "Use it as a directional signal alongside Overview and reports, not as an invoice.",
    ],
    notes: [
      "Totals are incomplete: Smart Upload caption generation is not yet logged in marketing_operations.",
      "Infrastructure costs (for example Vercel or Neon) are not included.",
      "Mock mode records zero cost; live figures are internal estimates only.",
    ],
  },
};

export const MARKETING_PAGE_GUIDE_IDS = Object.keys(
  MARKETING_PAGE_GUIDES,
) as MarketingPageGuideId[];

export function getMarketingPageGuide(id: MarketingPageGuideId): MarketingPageGuideEntry {
  return MARKETING_PAGE_GUIDES[id];
}
