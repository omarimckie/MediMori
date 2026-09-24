import { getNewsletterDiscountCode } from "@/lib/newsletter-constants";
import { AUDIENCE_DEFINITIONS, BRAND, CATEGORY_GUIDANCE, upcomingApprovedEvents } from "./brain";
import type { AudienceId, ContentCategory, MarketingCampaign } from "./types";

/** Pinterest pins per week when quotas use the default slot list (authoritative count is channel quota). */
export const PINTEREST_WEEKLY_CATEGORIES: ContentCategory[] = [
  "educational",
  "engagement",
  "product_feature",
];

export function conditionShortName(bookTitle: string): string {
  const short = bookTitle.replace(/^Children Diseases:\s*/i, "").trim();
  return short || bookTitle;
}

function pickVariant<T>(variants: T[], index: number): T {
  return variants[index % variants.length];
}

export function pinterestTitleFor(args: {
  category: ContentCategory;
  bookTitle: string;
  characterName: string | null;
  index: number;
}): string {
  const condition = conditionShortName(args.bookTitle);
  const character = args.characterName ?? "our story friend";

  if (args.category === "educational") {
    return pickVariant(
      [
        `What Is ${condition}?`,
        `A Simple Guide to ${condition} for Families`,
        `Helping Kids Understand ${condition}`,
      ],
      args.index,
    );
  }
  if (args.category === "engagement" || args.category === "community") {
    return pickVariant(
      [
        `Talking to Your Child About ${condition}`,
        `Gentle Ways to Start a Conversation About ${condition}`,
        `Questions Families Can Explore Together About ${condition}`,
      ],
      args.index,
    );
  }
  if (args.category === "product_feature" || args.category === "brand_story") {
    return pickVariant(
      [
        args.characterName ? `Meet ${args.characterName}: A Story About ${condition}` : `A Story About ${condition}`,
        `Inside ${args.bookTitle}`,
        `Why This Story Was Made for Kids Facing ${condition}`,
      ],
      args.index,
    );
  }

  return `${args.bookTitle} — ideas for families`;
}

export function pinterestCopyFor(args: {
  campaign: MarketingCampaign;
  category: ContentCategory;
  audience: AudienceId;
  bookTitle: string;
  bookId: string;
  characterName: string | null;
  index: number;
}): { title: string; body: string; cta: string } {
  const audienceName =
    AUDIENCE_DEFINITIONS.find((item) => item.id === args.audience)?.name ?? args.audience;
  const condition = conditionShortName(args.bookTitle);
  const event = upcomingApprovedEvents().find((item) => item.relatedBookId === args.bookId);
  const discount = getNewsletterDiscountCode();
  const guidance = CATEGORY_GUIDANCE[args.category];
  const title = pinterestTitleFor({
    category: args.category,
    bookTitle: args.bookTitle,
    characterName: args.characterName,
    index: args.index,
  });

  let opening: string;
  if (args.category === "educational") {
    opening = pickVariant(
      [
        `${condition} can feel like a big topic for little listeners. Here is a calm, age-appropriate way to explain what families often want kids to understand first.`,
        `When children ask about ${condition}, a simple explanation can open the door to trust. This pin focuses on clarity — not fear.`,
        `Learning about ${condition} together can start with one honest, gentle sentence. Save this for when your family is ready.`,
      ],
      args.index,
    );
  } else if (args.category === "engagement" || args.category === "community") {
    opening = pickVariant(
      [
        `You do not need a perfect script to talk about ${condition}. Try a short question, a story moment, or a quiet check-in — whatever fits your child today.`,
        `Three gentle conversation starters families use: name a feeling, share a fact from a trusted book, and invite your child to ask one question back.`,
        event
          ? `During ${event.name}, families often look for words that feel hopeful. ${condition} conversations can stay small, specific, and kind.`
          : `Community support often begins at home. These conversation ideas are meant for ${audienceName.toLowerCase()} — not lectures.`,
      ],
      args.index,
    );
  } else if (args.category === "product_feature" || args.category === "brand_story") {
    opening = args.characterName
      ? pickVariant(
          [
            `Meet ${args.characterName} — a Twilight Feather friend whose story helps families talk about ${condition} with warmth.`,
            `${args.bookTitle} follows ${args.characterName} through moments kids recognize — so health talk feels like story time, not a test.`,
            `Looking for a gentle read-aloud about ${condition}? ${args.characterName}'s story stays age-appropriate and never lectures.`,
          ],
          args.index,
        )
      : `${BRAND.displayName} built ${args.bookTitle} so families can discover a kinder way to read about ${condition} together.`;
  } else {
    opening = `${guidance} ${args.campaign.coreMessage}`;
  }

  const middle =
    args.category === "educational"
      ? `${guidance}`
      : args.category === "product_feature"
        ? `Inside ${args.bookTitle}: a story that stays age-appropriate and never lectures.`
        : `${guidance} ${args.campaign.coreMessage}`;

  const cta =
    args.category === "product_feature" || args.category === "conversion"
      ? `Read the eBook on twilight-feather.com. If you joined the list, ${discount} applies to eBooks on our site only — not paperbacks.`
      : `Visit the ${args.bookTitle} page on twilight-feather.com when you want to read together.`;

  const body = `${opening}\n\n${middle}\n\nPin this when you want a reminder that children's health stories can be kind, specific, and honest.\n\n${cta}`;

  return { title, body, cta };
}
