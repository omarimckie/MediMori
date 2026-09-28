import type { Book } from "@/lib/books";
import type { BlogPost } from "@/lib/blog";
import {
  isPhysicalDirectBookId,
  PHYSICAL_UNIT_PRICE_CENTS,
} from "@/lib/physical-books";
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
      return "Children's sickle cell picture book for families and classrooms. Paperback $10 + $4.99 shipping from Twilight Feather, $7 read-online eBook, or paperback on Amazon.";
    case "book-three":
      return "Children's asthma story (AJ Can Breathe Easy). Paperback $10 + $4.99 shipping from Twilight Feather, $7 read-online eBook, or paperback on Amazon.";
    case "book-two":
      return "Medicine-themed word search puzzles for kids and classrooms. $7 PDF download from Twilight Feather; paperback also available on Amazon.";
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

function twilightFeatherSeller() {
  return {
    "@type": "Organization" as const,
    name: SITE_NAME,
  };
}

function siteBookOffer(pageUrl: string, price: string) {
  return {
    "@type": "Offer" as const,
    url: pageUrl,
    priceCurrency: "USD",
    price,
    availability: "https://schema.org/InStock",
    itemCondition: "https://schema.org/NewCondition",
    seller: twilightFeatherSeller(),
  };
}

export function bookProductJsonLd(book: Book) {
  const pageUrl = absoluteUrl(`/books/${book.id}`);
  const image = book.coverImageUrl
    ? absoluteUrl(book.coverImageUrl)
    : absoluteUrl(DEFAULT_OG_IMAGE);

  const offers: ReturnType<typeof siteBookOffer>[] = [];

  const ebookPrice = ebookPriceAmount(book.priceEbook);
  if (ebookPrice != null) {
    offers.push(siteBookOffer(pageUrl, ebookPrice));
  }

  if (isPhysicalDirectBookId(book.id)) {
    const paperbackPrice = (PHYSICAL_UNIT_PRICE_CENTS / 100).toFixed(2);
    offers.push(siteBookOffer(pageUrl, paperbackPrice));
  }

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
    ...(offers.length > 0 ? { offers } : {}),
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
