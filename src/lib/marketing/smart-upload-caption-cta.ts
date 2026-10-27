import { catalogBooks } from "./brain";
import type { MarketingCampaign } from "./types";

export type SmartUploadCaptionCtaPrecedenceInput = {
  /** Structured explicit CTA (Phase 4B UI); not parsed from free-form instructions in 4A. */
  explicitCta: string | null;
  campaign: MarketingCampaign | null;
  bookId: string | null;
  modelInstagramCta: string | null;
  modelFacebookCta: string | null;
  modelSharedCta: string | null;
};

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export function defaultBookContextCta(bookId: string | null): string | null {
  if (!bookId) return null;
  const book = catalogBooks().find((row) => row.id === bookId);
  if (!book) return null;
  return `Read ${book.title} on twilight-feather.com`;
}

export function campaignCta(campaign: MarketingCampaign | null): string | null {
  return trimOrNull(campaign?.cta ?? null);
}

/**
 * Deterministic CTA precedence after model generation (per platform).
 * Instruction-derived CTA is not inferred in Phase 4A — use explicitCta when provided.
 */
export function resolveSmartUploadCaptionCta(
  input: SmartUploadCaptionCtaPrecedenceInput,
  platform: "instagram" | "facebook",
): string | null {
  const explicit = trimOrNull(input.explicitCta);
  if (explicit) return explicit;

  const fromCampaign = campaignCta(input.campaign);
  if (fromCampaign) return fromCampaign;

  const fromBook = defaultBookContextCta(input.bookId);
  if (fromBook) return fromBook;

  const modelCta =
    platform === "instagram"
      ? trimOrNull(input.modelInstagramCta)
      : trimOrNull(input.modelFacebookCta);
  if (modelCta) return modelCta;

  return trimOrNull(input.modelSharedCta);
}

export function sharedModeCta(input: SmartUploadCaptionCtaPrecedenceInput): string | null {
  return resolveSmartUploadCaptionCta(input, "instagram");
}
