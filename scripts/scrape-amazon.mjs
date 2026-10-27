/**
 * Fetches Amazon listing HTML and extracts (best-effort):
 * - description (meta, JSON-LD Product, book description block)
 * - cover + extra gallery image URLs (JSON-LD, og:image, hi-res data attributes)
 * - star rating + review count (JSON-LD aggregateRating, data-hook fallbacks)
 * - A+ / brand story plain text (heuristic block near common A+ container ids)
 *
 * Run: npm run scrape:amazon
 *
 * Amazon often blocks bots or serves minimal HTML — results vary by network.
 * Respect Amazon's terms; this is for your own catalog maintenance.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const booksPath = join(__dirname, "..", "src", "data", "books.json");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MAX_APLUS_CHARS = 20000;
const MAX_GALLERY_URLS = 16;

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&rlm;/gi, "")
    .replace(/&lrm;/gi, "");
}

function stripHtmlToText(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function pickDescription(html) {
  const og = html.match(
    /<meta\s+property="og:description"\s+content="([^"]*)"/i,
  );
  const ogText = og?.[1] ? decodeHtmlEntities(og[1]).trim() : "";

  const meta = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  const metaText = meta?.[1] ? decodeHtmlEntities(meta[1]).trim() : "";

  let fromBook = "";
  const bookDesc = html.match(
    /id="bookDescription_feature_div"[^>]*>([\s\S]*?)<\/div>/i,
  );
  if (bookDesc?.[1]) {
    const stripped = stripHtmlToText(bookDesc[1]);
    if (stripped.length > 40) fromBook = stripped;
  }

  const shortBlurb = ogText || metaText;
  if (fromBook.length > shortBlurb.length) return fromBook;
  return shortBlurb || fromBook || "";
}

function pickCoverImage(html) {
  const og = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i);
  if (og?.[1]) return decodeHtmlEntities(og[1]).trim();

  const tw = html.match(/<meta\s+name="twitter:image"\s+content="([^"]*)"/i);
  if (tw?.[1]) return decodeHtmlEntities(tw[1]).trim();

  return "";
}

function tryAsinCover(url) {
  const match = url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  if (!match?.[1]) return "";
  const asin = match[1].toUpperCase();
  return `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_.jpg`;
}

function normalizeImageUrl(url) {
  if (!url || typeof url !== "string") return "";
  let u = url.trim();
  if (!u.startsWith("http")) return "";
  u = decodeHtmlEntities(u);
  // Prefer larger landing images when Amazon uses size tokens
  u = u.replace(/\._SS\d+_/, "._SL1500_");
  return u;
}

function collectImagesFromHtml(html, baseImages) {
  const found = new Set(baseImages.filter(Boolean));

  // data-a-dynamic-image='{"url1":[w,h],...}'
  for (const m of html.matchAll(/data-a-dynamic-image="([^"]+)"/gi)) {
    try {
      const raw = m[1].replace(/&quot;/g, '"');
      const obj = JSON.parse(raw);
      for (const k of Object.keys(obj)) {
        const n = normalizeImageUrl(k);
        if (n) found.add(n);
      }
    } catch {
      /* skip */
    }
  }

  for (const m of html.matchAll(/data-old-hires="([^"]+)"/gi)) {
    const n = normalizeImageUrl(decodeHtmlEntities(m[1]));
    if (n) found.add(n);
  }

  for (const m of html.matchAll(/https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9._%-]+\.(?:jpg|jpeg|png)/gi)) {
    const n = normalizeImageUrl(m[0]);
    if (n) found.add(n);
  }

  return [...found].slice(0, MAX_GALLERY_URLS);
}

function extractJsonLdProductObjects(html) {
  const out = [];
  const re =
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const candidates = [];
    if (Array.isArray(data)) candidates.push(...data);
    else if (data && typeof data === "object") {
      if (Array.isArray(data["@graph"])) candidates.push(...data["@graph"]);
      else candidates.push(data);
    }
    for (const item of candidates) {
      if (!item || typeof item !== "object") continue;
      const types = item["@type"];
      const arr = Array.isArray(types) ? types : types ? [types] : [];
      if (arr.some((t) => String(t).toLowerCase().includes("product"))) {
        out.push(item);
      }
    }
  }
  return out;
}

function normalizeLdImages(imageField) {
  if (!imageField) return [];
  if (typeof imageField === "string") return [normalizeImageUrl(imageField)];
  if (Array.isArray(imageField)) {
    return imageField
      .flatMap((x) => {
        if (typeof x === "string") return [normalizeImageUrl(x)];
        if (x && typeof x === "object" && x.url)
          return [normalizeImageUrl(x.url)];
        return [];
      })
      .filter(Boolean);
  }
  if (typeof imageField === "object" && imageField.url) {
    return [normalizeImageUrl(imageField.url)].filter(Boolean);
  }
  return [];
}

function extractFromJsonLdProducts(products) {
  let description = "";
  let ratingValue = "";
  let reviewCount = "";
  const images = [];

  for (const p of products) {
    if (p.description && String(p.description).length > description.length) {
      description = stripHtmlToText(String(p.description));
    }
    const imgs = normalizeLdImages(p.image);
    for (const im of imgs) images.push(im);

    const ar = p.aggregateRating;
    if (ar && typeof ar === "object") {
      if (ar.ratingValue != null) ratingValue = String(ar.ratingValue).trim();
      const rc = ar.reviewCount ?? ar.ratingCount;
      if (rc != null) reviewCount = String(rc).trim();
    }
  }

  return { description, ratingValue, reviewCount, images };
}

function extractRatingFallbacks(html) {
  let stars = "";
  let count = "";

  const hook2 = html.match(/data-hook="rating-out-of-text"[^>]*>([^<]+)/i);
  if (hook2?.[1]) stars = decodeHtmlEntities(hook2[1]).trim();

  const hookAvg = html.match(
    /data-hook="average-star-rating[^"]*"[^>]*>[\s\S]{0,1200}?([\d.]+)\s*out\s+of\s*5/i,
  );
  if (hookAvg?.[1] && !stars) stars = `${hookAvg[1].trim()} out of 5`;

  const rv = html.match(/"averageRating"\s*:\s*([\d.]+)/);
  if (rv?.[1] && !stars) stars = `${rv[1]} out of 5`;

  const trc = html.match(/"totalReviewCount"\s*:\s*(\d+)/);
  if (trc?.[1]) count = trc[1];

  const acr = html.match(/id="acrCustomerReviewText"[^>]*>([^<(]+)/i);
  if (acr?.[1] && !count) {
    const digits = acr[1].replace(/[^\d]/g, "");
    if (digits) count = digits;
  }

  return { stars, count };
}

function extractAplusPlainText(html) {
  const markers = [
    /id="aplusBrandStory_feature_div"[^>]*>/i,
    /id="aplus_feature_div"[^>]*>/i,
    /id="aplus"[^>]*>/i,
    /cel_widget_id="AplusContent"[^>]*>/i,
    /feature-bullets-atf/i,
  ];
  for (const re of markers) {
    const match = re.exec(html);
    if (!match || match.index == null) continue;
    let idx = match.index;
    const lt = html.lastIndexOf("<", idx);
    if (lt >= 0 && lt > idx - 400) idx = lt;
    const slice = html.slice(idx, idx + 100000);
    const text = stripHtmlToText(slice);
    if (text.length > 300) return text.slice(0, MAX_APLUS_CHARS);
  }
  return "";
}

function buildStarLine(ratingValue, reviewCount, fallbackStars, fallbackCount) {
  const r = ratingValue || fallbackStars;
  const c = reviewCount || fallbackCount;
  if (!r && !c) return "";
  let line = "";
  if (r) {
    const rs = String(r);
    const lower = rs.toLowerCase();
    if (lower.includes("out of") || lower.includes("star")) line += rs;
    else line += `${rs} out of 5 stars`;
  }
  if (c) {
    line += line
      ? ` · ${Number(c).toLocaleString()} reviews`
      : `${Number(c).toLocaleString()} reviews`;
  }
  return line.trim();
}

async function fetchAmazonFields(url) {
  if (!url?.trim()) {
    return {
      description: "",
      coverImageUrl: "",
      amazonGalleryImageUrls: [],
      amazonStarRating: "",
      amazonReviewCount: "",
      amazonAplusText: "",
    };
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });

  const fallbackCover = tryAsinCover(url);

  if (!res.ok) {
    console.warn(`HTTP ${res.status} for ${url}`);
    return {
      description: "",
      coverImageUrl: fallbackCover,
      amazonGalleryImageUrls: fallbackCover ? [fallbackCover] : [],
      amazonStarRating: "",
      amazonReviewCount: "",
      amazonAplusText: "",
    };
  }

  const html = await res.text();

  const products = extractJsonLdProductObjects(html);
  const ld = extractFromJsonLdProducts(products);
  const fb = extractRatingFallbacks(html);

  const fromHtml = pickDescription(html);
  let description = ld.description || "";
  if (fromHtml.length > description.length) description = fromHtml;
  const coverImageUrl = pickCoverImage(html) || fallbackCover;

  const gallery = collectImagesFromHtml(html, [
    ...ld.images,
    coverImageUrl,
  ]).filter((u) => u && u.startsWith("http"));

  const starLine = buildStarLine(
    ld.ratingValue,
    ld.reviewCount,
    fb.stars,
    fb.count,
  );

  const amazonReviewCount =
    ld.reviewCount || fb.count
      ? String(ld.reviewCount || fb.count)
      : "";

  const aplus = extractAplusPlainText(html);

  return {
    description,
    coverImageUrl: coverImageUrl || fallbackCover,
    amazonGalleryImageUrls: gallery,
    amazonStarRating: starLine,
    amazonReviewCount,
    amazonAplusText: aplus,
  };
}

function mergeGalleryPreferUnique(a, b) {
  const s = new Set();
  const out = [];
  for (const list of [a, b]) {
    for (const u of list || []) {
      if (!u || s.has(u)) continue;
      s.add(u);
      out.push(u);
      if (out.length >= MAX_GALLERY_URLS) return out;
    }
  }
  return out;
}

async function main() {
  const raw = await readFile(booksPath, "utf8");
  const data = JSON.parse(raw);
  let changed = false;

  for (const book of data.books) {
    const sources = [book.amazonPaperbackUrl].filter(Boolean);
    if (!sources.length) {
      console.log(`Skipping ${book.id}: no Amazon URLs set.`);
      continue;
    }

    let bestDesc = "";
    let coverImageUrl = "";
    let mergedGallery = [];
    let bestStar = "";
    let bestReviewCount = "";
    let bestAplus = "";

    for (const u of sources) {
      const fields = await fetchAmazonFields(u);
      if (fields.description.length > bestDesc.length) bestDesc = fields.description;
      if (fields.coverImageUrl.length > coverImageUrl.length) {
        coverImageUrl = fields.coverImageUrl;
      }
      mergedGallery = mergeGalleryPreferUnique(mergedGallery, fields.amazonGalleryImageUrls);
      if (fields.amazonStarRating.length > bestStar.length) bestStar = fields.amazonStarRating;
      if (fields.amazonReviewCount && !bestReviewCount) {
        bestReviewCount = fields.amazonReviewCount;
      }
      if (fields.amazonAplusText.length > bestAplus.length) bestAplus = fields.amazonAplusText;
      await new Promise((r) => setTimeout(r, 900));
    }

    if (bestDesc) {
      book.description = bestDesc;
      changed = true;
      console.log(`Updated description for ${book.id} (${bestDesc.length} chars).`);
    } else {
      console.warn(`No description extracted for ${book.id}.`);
    }

    if (coverImageUrl) {
      book.coverImageUrl = coverImageUrl;
      changed = true;
      console.log(`Updated cover image for ${book.id}.`);
    }

    if (mergedGallery.length) {
      book.amazonGalleryImageUrls = mergedGallery;
      changed = true;
      console.log(`Updated gallery (${mergedGallery.length} images) for ${book.id}.`);
    }

    if (bestStar) {
      book.amazonStarRating = bestStar;
      changed = true;
      console.log(`Updated star line for ${book.id}: ${bestStar}`);
    } else {
      console.warn(`No star rating extracted for ${book.id}.`);
    }

    if (bestReviewCount) {
      book.amazonReviewCount = bestReviewCount;
      changed = true;
    }

    if (bestAplus) {
      book.amazonAplusText = bestAplus;
      changed = true;
      console.log(`Updated A+ / rich text for ${book.id} (${bestAplus.length} chars).`);
    } else {
      console.warn(`No A+ / brand story block extracted for ${book.id}.`);
    }
  }

  if (changed) {
    await writeFile(booksPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log("Wrote src/data/books.json");
  } else {
    console.log("No updates written.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
