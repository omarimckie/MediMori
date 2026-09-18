import type { Book } from "@/lib/books";
import type { BlogPost } from "@/lib/blog";
import { absoluteUrl, getSiteUrl } from "@/lib/site";

export const SITE_NAME = "Twilight Feather";
export const SITE_NAME_SHORT = "Twilight Feather";

export const DEFAULT_TITLE =
  "Twilight Feather — Children’s Health Storybooks";
export const DEFAULT_DESCRIPTION =
  "Children’s picture books that explain sickle cell, asthma, and health in an age-appropriate way. Read online or download Word Search PDFs from Twilight Feather.";

export const DEFAULT_OG_IMAGE = "/children-reading.png";

export function siteMetadataBase(): URL {
  return new URL(`${getSiteUrl()}/`);
}

/** Parse catalog price strings like "$7.00" into a decimal amount for Offer schema. */
export function ebookPriceAmount(priceEbook: string | undefined): string | null {
  const raw = priceEbook?.trim();
  if (!raw) return null;
  const match = raw.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return amount.toFixed(2);
}

export function bookSeoTitle(book: Book): string {
  switch (book.id) {
    case "book-one":
      return "Sickle Cell Children’s Book — Children Diseases: Sickle Cell";
    case "book-three":
      return "Asthma Children’s Book — AJ Can Breathe Easy";
    case "book-two":
      return "Health & Medicine Word Search Collection — PDF Download";
    default:
      return book.title;
  }
}

export function bookSeoDescription(book: Book): string {
  switch (book.id) {
    case "book-one":
      return "A children’s picture book that helps families explain sickle cell disease with warmth and courage. Read Amara’s story online with Twilight Feather — $7 eBook, no offline PDF.";
    case "book-three":
      return "A gentle children’s asthma story about AJ learning to stay active and confident. Read AJ Can Breathe Easy online with Twilight Feather — $7 eBook, browser-only.";
    case "book-two":
      return "60 medicine-themed word search puzzles for kids, families, and classrooms. Download the Health & Medicine Word Search Collection PDF from Twilight Feather — $7.";
    default: {
      const fromTagline = book.tagline?.trim();
      if (fromTagline) return fromTagline;
      return book.description.trim();
    }
  }
}

export function organizationJsonLd() {
  const url = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url,
    logo: absoluteUrl("/feather-accent.png"),
    sameAs: [
      "https://www.instagram.com/twilight.feather/",
      "https://www.facebook.com/twilight.feather/",
      "https://tiktok.com/@twilightfeather",
    ],
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: getSiteUrl(),
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
    },
  };
}

export function bookProductJsonLd(book: Book) {
  const url = absoluteUrl(`/books/${book.id}`);
  const price = ebookPriceAmount(book.priceEbook);
  const image = book.coverImageUrl
    ? absoluteUrl(book.coverImageUrl)
    : absoluteUrl(DEFAULT_OG_IMAGE);

  const offer =
    price != null
      ? {
          "@type": "Offer" as const,
          url,
          priceCurrency: "USD",
          price,
          availability: "https://schema.org/InStock",
          itemCondition: "https://schema.org/NewCondition",
        }
      : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: book.title,
    description: bookSeoDescription(book),
    image,
    sku: book.id,
    brand: {
      "@type": "Brand",
      name: SITE_NAME,
    },
    ...(offer ? { offers: offer } : {}),
  };
}

export function blogPostingJsonLd(post: BlogPost, authorName?: string) {
  const url = absoluteUrl(`/blog/${post.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt,
    mainEntityOfPage: url,
    url,
    ...(post.imageUrl
      ? { image: [absoluteUrl(post.imageUrl)] }
      : {}),
    ...(authorName
      ? {
          author: {
            "@type": "Person",
            name: authorName,
          },
        }
      : {
          author: {
            "@type": "Organization",
            name: SITE_NAME,
          },
        }),
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl("/feather-accent.png"),
      },
    },
  };
}
