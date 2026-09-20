import { getNewsletterDiscountCode } from "@/lib/newsletter-constants";
import {
  AUDIENCE_DEFINITIONS,
  BRAND,
  CATEGORY_GUIDANCE,
  catalogBooks,
  catalogCharacters,
  defaultTemplates,
  platformVoice,
  upcomingApprovedEvents,
} from "./brain";
import { getMarketingTimezone } from "./config";
import { platformScheduleSlot, rotate } from "./planner";
import { scanMarketingText } from "./safety";
import type { MarketingStore } from "./store";
import type {
  AudienceId,
  ChannelQuotas,
  ContentCategory,
  ContentFormat,
  MarketingAsset,
  MarketingCampaign,
  MarketingContent,
  Platform,
  WeeklyPlan,
} from "./types";

const CATEGORY_ROTATION: ContentCategory[] = [
  "educational",
  "brand_story",
  "product_feature",
  "engagement",
  "trust",
  "conversion",
  "community",
];

const FORMAT_FOR_PLATFORM: Record<Platform, ContentFormat[]> = {
  instagram: ["post", "carousel", "reel_script", "story", "post"],
  facebook: ["post", "post", "post", "post", "post"],
  pinterest: ["pin", "pin", "pin", "pin", "pin", "pin", "pin"],
  email: ["email"],
  website: ["article"],
  google: ["google_update"],
};

function bookFor(campaign: MarketingCampaign, index: number) {
  const books = catalogBooks().filter((book) => campaign.bookIds.includes(book.id));
  return books[index % Math.max(books.length, 1)] ?? catalogBooks()[0];
}

function characterFor(bookId: string | undefined) {
  const id = bookId === "book-one" ? "amara" : bookId === "book-three" ? "aj" : null;
  return catalogCharacters().find((item) => item.id === id) ?? null;
}

function audienceFor(campaign: MarketingCampaign, index: number): AudienceId {
  const list = [campaign.primaryAudience, campaign.secondaryAudience].filter(
    Boolean,
  ) as AudienceId[];
  return list[index % list.length] ?? "parents";
}

function copyFor(args: {
  campaign: MarketingCampaign;
  platform: Platform;
  format: ContentFormat;
  category: ContentCategory;
  audience: AudienceId;
  bookTitle: string;
  bookId: string;
  characterName: string | null;
  index: number;
}) {
  const audienceName =
    AUDIENCE_DEFINITIONS.find((item) => item.id === args.audience)?.name ?? args.audience;
  const event = upcomingApprovedEvents().find((item) => item.relatedBookId === args.bookId);
  const discount = getNewsletterDiscountCode();
  const guidance = CATEGORY_GUIDANCE[args.category];
  const voice = platformVoice(args.platform);

  const openings: Record<ContentCategory, string> = {
    educational: `Talking to a child about ${args.bookTitle.replace("Children Diseases: ", "")} doesn't have to feel scary.`,
    brand_story: args.characterName
      ? `Meet ${args.characterName} — a Twilight Feather friend who helps families start gentle conversations.`
      : `${BRAND.displayName} exists so families can talk about health with warmth, not panic.`,
    product_feature: `Inside ${args.bookTitle}: a story that stays age-appropriate and never lectures.`,
    engagement: `Parents — how do you start a hard health conversation without making it feel like a lecture?`,
    trust: `${args.bookTitle} is written for families, classrooms, and healthcare offices. We do not invent reviews or institutional users.`,
    conversion:
      args.category === "conversion"
        ? `When you are ready, you can read ${args.bookTitle} as an eBook on twilight-feather.com.`
        : `Read ${args.bookTitle} with your child.`,
    community: event
      ? `${event.name} is a moment to share stories, not statistics. ${args.bookTitle} is one way families can talk together.`
      : `Community reading starts at home — ${args.bookTitle} is built for those quiet conversations.`,
  };

  const middle = `${guidance} ${args.campaign.coreMessage}`;
  const cta =
    args.category === "conversion"
      ? `Read the eBook on twilight-feather.com. If you joined the list, ${discount} applies to eBooks on our site only — not paperbacks.`
      : `Visit the ${args.bookTitle} page on twilight-feather.com when you want to read together.`;

  if (args.platform === "pinterest") {
    return {
      title: `${args.bookTitle} — a gentle conversation starter for ${audienceName}`,
      body: `${openings[args.category]}\n\nPin this as a reminder that children's health stories can be kind, specific, and honest.\n\n${cta}`,
      cta,
      seoTitle: null,
      seoDescription: null,
    };
  }
  if (args.platform === "email") {
    return {
      title: `This week's story: ${args.bookTitle}`,
      body: `Subject: A gentler way to talk about ${args.bookTitle.replace("Children Diseases: ", "")}\n\nHi,\n\n${openings[args.category]}\n\n${middle}\n\n${cta}\n\nWith care,\nTwilight Feather`,
      cta,
      seoTitle: null,
      seoDescription: null,
    };
  }
  if (args.platform === "website") {
    const seoTitle = `${args.bookTitle}: a parent-friendly reading guide`;
    const seoDescription = `How ${BRAND.displayName} helps families talk about ${args.bookTitle} with warmth. No medical advice — just a story to start the conversation.`;
    return {
      title: seoTitle,
      body: `# ${seoTitle}\n\n${openings[args.category]}\n\n${middle}\n\n${voice}\n\n${cta}`,
      cta,
      seoTitle,
      seoDescription,
    };
  }
  if (args.platform === "google") {
    return {
      title: "This week's reading note",
      body: `${openings[args.category]} Find ${args.bookTitle} at twilight-feather.com.`,
      cta,
      seoTitle: null,
      seoDescription: null,
    };
  }
  if (args.format === "reel_script") {
    return {
      title: `${args.characterName ?? "Story"} moment`,
      body: `Hook: ${openings[args.category]}\nScene: Show the approved cover, then one interior preview.\nVoiceover: Stay with approved story facts only.\nCTA: ${cta}`,
      cta,
      seoTitle: null,
      seoDescription: null,
    };
  }
  if (args.format === "carousel") {
    return {
      title: `What's inside ${args.bookTitle}`,
      body: `Slide 1: ${openings[args.category]}\nSlide 2: ${args.campaign.coreMessage}\nSlide 3: Who it's for — ${audienceName}.\nSlide 4: ${cta}`,
      cta,
      seoTitle: null,
      seoDescription: null,
    };
  }
  if (args.format === "story") {
    return {
      title: "Story sticker idea",
      body: `${openings[args.category]}\nSticker: “Read together tonight?”\nLink sticker to the book page.`,
      cta,
      seoTitle: null,
      seoDescription: null,
    };
  }

  return {
    title: openings[args.category],
    body: `${openings[args.category]}\n\n${middle}\n\n${cta}`,
    cta,
    seoTitle: null,
    seoDescription: null,
  };
}

export function selectAsset(
  assets: MarketingAsset[],
  args: { bookId: string | null; characterId: string | null; platform: Platform },
): { asset: MarketingAsset | null; needsNewAsset: boolean; source: string } {
  const approved = assets.filter((asset) => asset.approved);
  const byBook = approved.filter((asset) => !args.bookId || asset.bookId === args.bookId);
  const character = byBook.find((asset) => args.characterId && asset.characterId === args.characterId);
  if (character) return { asset: character, needsNewAsset: false, source: "existing_approved_asset" };
  const cover = byBook.find((asset) => asset.type === "cover");
  if (cover) return { asset: cover, needsNewAsset: false, source: "existing_approved_asset" };
  const interior = byBook.find((asset) => asset.type === "interior");
  if (interior) return { asset: interior, needsNewAsset: false, source: "existing_asset_transformed" };
  const template = approved.find((asset) => asset.type === "template");
  if (template) return { asset: template, needsNewAsset: false, source: "existing_template" };
  return { asset: null, needsNewAsset: true, source: "new_generated_asset_request" };
}

export async function generateWeeklyContent(
  store: MarketingStore,
  campaign: MarketingCampaign,
  plan: WeeklyPlan,
  quotas: ChannelQuotas,
) {
  const existing = await store.listContent({ weeklyPlanId: plan.id });
  if (existing.length) return existing;

  const assets = await store.listAssets();
  const templates = await store.listTemplates();
  if (!templates.length) {
    for (const template of defaultTemplates()) {
      await store.createTemplate({ ...template });
    }
  }

  const created: MarketingContent[] = [];
  const categories = rotate(CATEGORY_ROTATION, new Date(plan.weekStart).getUTCDate());
  let slot = 0;

  for (const platform of Object.keys(quotas) as Platform[]) {
    const count = quotas[platform] ?? 0;
    const formats = FORMAT_FOR_PLATFORM[platform];
    for (let index = 0; index < count; index += 1) {
      const book = bookFor(campaign, slot);
      const character = characterFor(book.id);
      const category = categories[slot % categories.length];
      const format = formats[index % formats.length];
      const audience = audienceFor(campaign, slot);
      const copy = copyFor({
        campaign,
        platform,
        format,
        category,
        audience,
        bookTitle: book.title,
        bookId: book.id,
        characterName: character?.name ?? null,
        index,
      });
      const chosen = selectAsset(assets, {
        bookId: book.id,
        characterId: character?.id ?? null,
        platform,
      });
      const flags = scanMarketingText(`${copy.title ?? ""}\n${copy.body}\n${copy.cta}`);
      const warnings = [
        ...flags.map((flag) => flag.message),
        chosen.needsNewAsset
          ? "No approved asset matched this item. A new asset is requested — not auto-generated."
          : null,
        category === "trust"
          ? "Trust content avoids fabricated reviews. Owner can attach an approved testimonial later."
          : null,
      ].filter((item): item is string => Boolean(item));

      const item = await store.createContent({
        id: crypto.randomUUID(),
        campaignId: campaign.id,
        weeklyPlanId: plan.id,
        platform,
        format,
        category,
        audience,
        status: "needs_review",
        title: copy.title,
        body: copy.body,
        cta: copy.cta,
        seoTitle: copy.seoTitle,
        seoDescription: copy.seoDescription,
        scheduledFor: platformScheduleSlot(plan.weekStart, platform, index),
        timezone: getMarketingTimezone(),
        assetIds: chosen.asset ? [chosen.asset.id] : [],
        needsNewAsset: chosen.needsNewAsset,
        warnings,
        safetyFlags: flags,
        trackingToken: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
        originalBody: copy.body,
        bookId: book.id,
        isDemo: campaign.isDemo,
      });
      await store.recordEvent({
        id: crypto.randomUUID(),
        name: "content_generated",
        campaignId: campaign.id,
        contentId: item.id,
        platform,
        properties: { category, format, assetSource: chosen.source },
      });
      created.push(item);
      slot += 1;
    }
  }

  const newAssetCount = created.filter((item) => item.needsNewAsset).length;
  const warningCount = created.filter((item) => item.warnings.length || item.safetyFlags.length).length;
  await store.updateWeeklyPlan(plan.id, {
    status: "ready",
    summary: {
      ...plan.summary,
      itemCount: created.length,
      newAssetCount,
      warningCount,
    },
  });

  return created;
}

export async function regenerateContent(store: MarketingStore, content: MarketingContent) {
  if (!content.campaignId) return content;
  const campaign = await store.getCampaign(content.campaignId);
  if (!campaign) return content;
  const book = catalogBooks().find((item) => item.id === content.bookId) ?? catalogBooks()[0];
  const character = characterFor(book.id);
  const copy = copyFor({
    campaign,
    platform: content.platform,
    format: content.format,
    category: content.category,
    audience: content.audience,
    bookTitle: book.title,
    bookId: book.id,
    characterName: character?.name ?? null,
    index: 1,
  });
  const flags = scanMarketingText(copy.body);
  const updated = await store.updateContent(content.id, {
    body: `${copy.body}\n\n(Regenerated variant)`,
    title: copy.title,
    cta: copy.cta,
    originalBody: content.originalBody ?? content.body,
    status: "needs_review",
    safetyFlags: flags,
    warnings: flags.map((flag) => flag.message),
  });
  return updated ?? content;
}
