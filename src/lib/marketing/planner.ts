import {
  AUDIENCE_DEFINITIONS,
  APPROVED_CLAIMS,
  BRAND,
  CTA_RULES,
  catalogBooks,
  upcomingApprovedEvents,
} from "./brain";
import { DEFAULT_CHANNEL_QUOTAS, parseChannelQuotas } from "./config";
import { addDays, mondayOf } from "./json";
import type { MarketingStore } from "./store";
import type {
  AudienceId,
  ChannelQuotas,
  MarketingCampaign,
  Platform,
} from "./types";

function detectBooks(objective: string) {
  const books = catalogBooks();
  const lower = objective.toLowerCase();
  const matched = books.filter((book) => {
    const haystack = `${book.id} ${book.title} ${book.tagline ?? ""}`.toLowerCase();
    return (
      (lower.includes("sickle") && book.id === "book-one") ||
      (lower.includes("asthma") && book.id === "book-three") ||
      (lower.includes("word search") && book.id === "book-two") ||
      haystack.split(" ").some((word) => word.length > 4 && lower.includes(word))
    );
  });
  if (matched.length) return [...new Set(matched.map((book) => book.id))];
  if (lower.includes("all") || lower.includes("catalog")) return books.map((book) => book.id);
  return ["book-one"];
}

function detectAudience(objective: string): { primary: AudienceId; secondary: AudienceId | null } {
  const lower = objective.toLowerCase();
  if (lower.includes("school") || lower.includes("teacher") || lower.includes("classroom")) {
    return { primary: "schools", secondary: "parents" };
  }
  if (lower.includes("hospital") || lower.includes("clinic") || lower.includes("pediatric")) {
    return { primary: "hospitals", secondary: "parents" };
  }
  if (lower.includes("library") || lower.includes("community")) {
    return { primary: "libraries", secondary: "parents" };
  }
  return { primary: "parents", secondary: "schools" };
}

export async function getChannelQuotas(store: MarketingStore): Promise<ChannelQuotas> {
  const stored = await store.getSetting("channel_quotas", DEFAULT_CHANNEL_QUOTAS);
  return parseChannelQuotas(stored);
}

export async function createCampaignFromObjective(
  store: MarketingStore,
  input: { objective: string; actor?: string | null; days?: number },
): Promise<MarketingCampaign> {
  const books = catalogBooks();
  const bookIds = detectBooks(input.objective);
  const selected = books.filter((book) => bookIds.includes(book.id));
  const audiences = detectAudience(input.objective);
  const quotas = await getChannelQuotas(store);
  const start = new Date();
  const days = input.days ?? 30;
  const primaryBook = selected[0];
  const events = upcomingApprovedEvents(start);
  const relevantEvent = events.find((event) => bookIds.includes(event.relatedBookId));
  const claim =
    APPROVED_CLAIMS.find((item) => item.bookId === primaryBook?.id)?.body ??
    APPROVED_CLAIMS[0].body;

  const campaign: MarketingCampaign = {
    id: crypto.randomUUID(),
    name: primaryBook
      ? `Promote ${primaryBook.title.replace("Children Diseases: ", "")}`
      : "Promote Twilight Feather",
    objective: input.objective.trim(),
    status: "active",
    primaryAudience: audiences.primary,
    secondaryAudience: audiences.secondary,
    coreMessage: claim,
    contentThemes: [
      "Age-appropriate explanation",
      "Character-led comfort",
      "Parent conversation starter",
      relevantEvent ? relevantEvent.name : "Everyday family reading",
    ],
    channelDistribution: quotas,
    recommendedFrequency: {
      instagram: `${quotas.instagram} items / week`,
      facebook: `${quotas.facebook} items / week`,
      pinterest: `${quotas.pinterest} evergreen pins / week`,
      email: `${quotas.email} campaign / week`,
      website: `${quotas.website} article / week`,
      google: `${quotas.google} update / week`,
    },
    cta: primaryBook
      ? `Read ${primaryBook.title} on twilight-feather.com`
      : CTA_RULES.default,
    requiredAssets: [
      "Approved cover",
      "Interior preview if available",
      "Character artwork if the story has a character",
    ],
    measurementGoals: [
      "Track clicks from content to the book page",
      "Watch email opens without claiming purchase causation too early",
      "Correlate purchases of the promoted book as assisted unless a tracking token is present",
    ],
    bookIds,
    startOn: start.toISOString().slice(0, 10),
    endOn: addDays(start.toISOString().slice(0, 10), days).slice(0, 10),
    createdBy: input.actor ?? null,
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const saved = await store.createCampaign(campaign);
  await store.recordEvent({
    id: crypto.randomUUID(),
    name: "campaign_created",
    campaignId: saved.id,
    contentId: null,
    platform: null,
    properties: { bookIds, audience: saved.primaryAudience },
  });
  return saved;
}

export async function buildWeeklyPlan(
  store: MarketingStore,
  campaign: MarketingCampaign,
  weekStart = mondayOf(),
) {
  const quotas = await getChannelQuotas(store);
  const existing = await store.findWeeklyPlan(campaign.id, weekStart);
  if (existing) return existing;

  const recent = await store.listContent({ campaignId: campaign.id });
  const preferences = (await store.listPreferences()).filter((item) => item.active);
  const events = upcomingApprovedEvents();
  const itemCount = (Object.values(quotas) as number[]).reduce((sum, value) => sum + value, 0);

  const plan = await store.createWeeklyPlan({
    id: crypto.randomUUID(),
    campaignId: campaign.id,
    weekStart,
    status: "draft",
    summary: {
      itemCount,
      newAssetCount: 0,
      warningCount: 0,
      objective: campaign.objective,
      audience: AUDIENCE_DEFINITIONS.find((item) => item.id === campaign.primaryAudience)?.name ??
        campaign.primaryAudience,
      quotas,
    },
    rationale: {
      activeCampaign: campaign.name,
      recentlyPublished: recent.filter((item) => item.status === "published").length,
      productPriorities: campaign.bookIds,
      audienceRotation: [campaign.primaryAudience, campaign.secondaryAudience].filter(Boolean),
      upcomingEvents: events.map((event) => event.name),
      ownerPreferences: preferences
        .filter((item) => item.ownerConfirmed)
        .map((item) => item.statement),
      brand: BRAND.tagline,
    },
    isDemo: campaign.isDemo,
  });
  return plan;
}

export function rotate<T>(items: T[], offset: number): T[] {
  if (!items.length) return items;
  const start = offset % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

export function platformScheduleSlot(
  weekStart: string,
  platform: Platform,
  index: number,
): string {
  const dayMap: Record<Platform, number[]> = {
    instagram: [0, 1, 2, 3, 4],
    facebook: [0, 1, 2, 3, 4],
    pinterest: [0, 1, 2, 3, 4, 5, 6],
    email: [1],
    website: [2],
    google: [3],
  };
  const days = dayMap[platform];
  const day = days[index % days.length] ?? index;
  const hours: Record<Platform, number> = {
    instagram: 15,
    facebook: 16,
    pinterest: 10,
    email: 9,
    website: 8,
    google: 11,
  };
  const date = new Date(`${weekStart}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + day);
  date.setUTCHours(hours[platform], (index * 7) % 50, 0, 0);
  return date.toISOString();
}
