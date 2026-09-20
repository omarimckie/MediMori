import { authors } from "@/data/authors";
import { friends } from "@/data/friends";
import { missionHeadline, missionIntroduction, missionPrinciples } from "@/data/mission";
import { getBooks } from "@/lib/books";
import { getNewsletterDiscountCode } from "@/lib/newsletter-constants";
import type {
  AudienceId,
  ContentCategory,
  MarketingTemplate,
  Platform,
} from "./types";

export type AudienceDefinition = {
  id: AudienceId;
  name: string;
  priority: "primary" | "secondary" | "third" | "fourth";
  description: string;
  role: string;
};

export const BRAND = {
  name: "twilight.feather",
  displayName: "Twilight Feather",
  tagline: "Empowering Little Minds, Nurturing Wellness.",
  voice: [
    "Warm and conversational, never clinical or alarming.",
    "Speak to the adult decision-maker while honoring the child as the reader.",
    "Hopeful, gentle, and specific — avoid generic wellness slogans.",
    "Use story and character before product pitch.",
  ],
  values: missionPrinciples.map((item) => item.name),
  missionHeadline,
  missionIntroduction,
};

export const AUDIENCE_DEFINITIONS: AudienceDefinition[] = [
  {
    id: "parents",
    name: "Parents / caregivers",
    priority: "primary",
    description: "Adults helping a child understand a health condition at home.",
    role: "Usually the purchaser and the person who reads with the child.",
  },
  {
    id: "hospitals",
    name: "Hospitals / pediatric practices",
    priority: "secondary",
    description: "Clinics and care teams looking for age-appropriate conversation starters.",
    role: "May recommend or stock books; not assumed partners unless approved.",
  },
  {
    id: "schools",
    name: "Schools / teachers",
    priority: "third",
    description: "Educators supporting classmates, SEL, and health literacy.",
    role: "Decision-maker for classroom use; child remains the reader.",
  },
  {
    id: "libraries",
    name: "Libraries / community organizations",
    priority: "fourth",
    description: "Community collections and local programs.",
    role: "May acquire books for public shelves; do not invent partnerships.",
  },
];

export const APPROVED_CALENDAR = [
  {
    id: "sickle-cell-awareness-month",
    name: "National Sickle Cell Awareness Month",
    month: 9,
    day: null as number | null,
    relatedBookId: "book-one",
    source: "U.S. public awareness designation — not a Twilight Feather-created event.",
  },
  {
    id: "asthma-allergy-awareness-month",
    name: "National Asthma and Allergy Awareness Month",
    month: 5,
    day: null as number | null,
    relatedBookId: "book-three",
    source: "U.S. public awareness designation — not a Twilight Feather-created event.",
  },
];

export const CTA_RULES = {
  default: "Invite the adult to read the story together — then link to the book page.",
  ebookDiscount:
    "The newsletter/site promotion code applies to eBooks purchased on twilight-feather.com only. Never say it applies to paperbacks or Amazon.",
  amazonPaperback: "Paperback purchase links may point to Amazon. Do not mix ebook discount language with paperback CTAs.",
  noPressure: "Do not use scarcity, fear, or medical urgency to sell.",
};

export function catalogBooks() {
  return getBooks().map((book) => ({
    id: book.id,
    title: book.title,
    tagline: book.tagline ?? null,
    description: book.description,
    pricePaperback: book.pricePaperback ?? null,
    priceEbook: book.priceEbook ?? null,
    coverImageUrl: book.coverImageUrl ?? null,
    insideImageUrls: book.insideImageUrls ?? [],
    amazonPaperbackUrl: book.amazonPaperbackUrl ?? null,
    characterId: book.id === "book-one" ? "amara" : book.id === "book-three" ? "aj" : null,
  }));
}

export function catalogCharacters() {
  return friends.map((friend) => ({
    id: friend.id,
    name: friend.name,
    tagline: friend.tagline,
    introduction: friend.introduction,
    personality: friend.personality,
    imageSrc: friend.imageSrc ?? null,
  }));
}

export function catalogAuthors() {
  return authors.map((author) => ({
    id: author.id,
    name: author.name,
    tagline: author.tagline,
    bio: author.bio,
  }));
}

export function promotionalRules() {
  return [
    `eBook price on the website is currently $7.00 for catalog titles.`,
    `Paperback prices stay on Amazon and are not discounted by ${getNewsletterDiscountCode()}.`,
    `${getNewsletterDiscountCode()} is an eBook-only site checkout code unless the website data changes.`,
    "Do not invent bundle offers, hospital contracts, or school adoptions.",
  ];
}

export const APPROVED_CLAIMS: Array<{ id: string; bookId?: string; body: string }> = [
  {
    id: "series-purpose",
    body: "Twilight Feather creates children's stories that help families understand health topics with warmth and care.",
  },
  {
    id: "sickle-cell-story",
    bookId: "book-one",
    body: "Children Diseases: Sickle Cell follows Amara as she learns, with her parents and a kind doctor, that she has sickle cell anemia, and that she is strong, brave, and never alone.",
  },
  {
    id: "asthma-story",
    bookId: "book-three",
    body: "AJ Can Breathe Easy is a gentle story about AJ learning that asthma does not have to stop him from doing the things he loves, with help from his inhaler, family, and growing confidence.",
  },
  {
    id: "word-search",
    bookId: "book-two",
    body: "The Health & Medicine Word Search Collection contains 60 medicine-themed puzzles in large print, with answers in the back.",
  },
  {
    id: "audiences",
    body: "The books are described as useful for families, classrooms, and healthcare offices. That is positioning, not a claim that specific institutions currently use them.",
  },
];

export const RESTRICTED_CLAIMS = [
  "Do not invent medical statistics, prevalence numbers, outcomes, or cure claims.",
  "Do not give treatment, diagnosis, or medication advice.",
  "Do not fabricate testimonials, reviews, credentials, media coverage, or institutional users.",
  "Do not imply Twilight Feather is a medical authority.",
  "Do not invent awareness dates or partnerships.",
  "Do not say the 10% / newsletter code discounts physical books.",
];

export const CATEGORY_GUIDANCE: Record<ContentCategory, string> = {
  educational:
    "Explain a health idea in age-appropriate, non-clinical language. Stay inside approved story facts.",
  brand_story:
    "Tell why Twilight Feather exists, introduce Amara or AJ, or share the authors' care for families — without new medical claims.",
  product_feature:
    "Show what is inside a specific book: cover, character, tone, who it is for.",
  engagement:
    "Ask a parent-friendly question or prompt. Do not run medical quizzes that diagnose.",
  trust:
    "Only use owner-approved reviews, credentials, or organizations. If none are on file, do not invent them — talk about the book's intended use instead and flag the gap.",
  conversion:
    "Invite a purchase with a clear CTA. eBook discount language must stay ebook-only.",
  community:
    "Reference only approved calendar events. Do not invent local events or institutional programs.",
};

export function defaultTemplates(): Omit<MarketingTemplate, "createdAt">[] {
  const categories: Array<{
    category: ContentCategory;
    name: string;
    bodyGuidance: string;
  }> = [
    {
      category: "educational",
      name: "Parent education",
      bodyGuidance: "Open with a child's feeling, then a gentle explanation from the approved story.",
    },
    {
      category: "educational",
      name: "Did you know (story-safe)",
      bodyGuidance: "Share one approved story fact. No statistics.",
    },
    {
      category: "brand_story",
      name: "Meet the character",
      bodyGuidance: "Introduce Amara or AJ using catalog personality lines only.",
    },
    {
      category: "brand_story",
      name: "Why we exist",
      bodyGuidance: "Use the mission headline and values. No new origin myths.",
    },
    {
      category: "product_feature",
      name: "What's inside",
      bodyGuidance: "Point to cover, interior preview, and the book's comfort-first tone.",
    },
    {
      category: "engagement",
      name: "Parent question",
      bodyGuidance: "Ask how families start hard conversations. Do not request private health details.",
    },
    {
      category: "trust",
      name: "Intended setting",
      bodyGuidance: "Mention families, classrooms, and healthcare offices as intended settings, not as proven customers.",
    },
    {
      category: "conversion",
      name: "Ebook invitation",
      bodyGuidance: "Invite readers to the book page. Mention the ebook-only code only when the campaign is promotional.",
    },
    {
      category: "community",
      name: "Awareness month",
      bodyGuidance: "If an approved calendar event applies, acknowledge it and offer the related story. Otherwise skip this category.",
    },
  ];

  return categories.map((item) => ({
    id: crypto.randomUUID(),
    name: item.name,
    category: item.category,
    platform: null,
    structure: { bodyGuidance: item.bodyGuidance },
    active: true,
  }));
}

export function platformVoice(platform: Platform): string {
  switch (platform) {
    case "instagram":
      return "Short, warm, visual. Lead with a feeling or character moment. Light hashtags only if natural.";
    case "facebook":
      return "A little longer. Speak to caregivers in complete sentences. Invite comments without mining health stories.";
    case "pinterest":
      return "Searchable and specific. Title-like first line. Evergreen, not recap-of-the-week.";
    case "email":
      return "One idea, one book, one CTA. Subject line must not sensationalize illness.";
    case "website":
      return "Helpful article structure with SEO title/description. Stay inside approved claims.";
    case "google":
      return "Brief Google Business update. Factual, local-friendly, no medical advice.";
  }
}

export function brainSnapshot() {
  return {
    brand: BRAND,
    audiences: AUDIENCE_DEFINITIONS,
    books: catalogBooks(),
    characters: catalogCharacters(),
    authors: catalogAuthors(),
    approvedClaims: APPROVED_CLAIMS,
    restrictedClaims: RESTRICTED_CLAIMS,
    ctaRules: CTA_RULES,
    promotionalRules: promotionalRules(),
    approvedCalendar: APPROVED_CALENDAR,
    categories: CATEGORY_GUIDANCE,
  };
}

export function upcomingApprovedEvents(now = new Date()) {
  const month = now.getUTCMonth() + 1;
  const upcoming = APPROVED_CALENDAR.filter(
    (event) => event.month === month || event.month === (month % 12) + 1,
  );
  return upcoming;
}
