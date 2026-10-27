import { SmartUploadCaptionGroundingError } from "./smart-upload-caption-errors";
import { normalizeInstagramHashtag } from "./smart-upload-caption-hashtags";

const UNSAFE_CLINICAL_HASHTAG_CORE =
  /(cure|cures|curing|prevent|prevents|prevention|stopattack|stopattacks|medicinestop|medicinestops|guarantee|guaranteed|treats|treatment|heals|healing|diagnose|diagnosis|prescribe|prescription)/i;

const UNSAFE_DISEASE_PREVENT_COMBO =
  /(preventsickle|preventasthma|asthmacure|sicklecellcure|stopasthma|stopattacks)/i;

/**
 * Rejects hashtags that assert unsupported clinical outcomes (cure/prevent/treat-as-fact).
 * Neutral tags like #KidsHealth or #SickleCellAwareness are not blocked by disease name alone.
 */
export function assertClinicalHashtagsSafe(rawTags: string[]): void {
  for (const raw of rawTags) {
    const normalized = normalizeInstagramHashtag(raw);
    if (!normalized) continue;
    const core = normalized.replace(/^#/, "");
    if (UNSAFE_CLINICAL_HASHTAG_CORE.test(core) || UNSAFE_DISEASE_PREVENT_COMBO.test(core)) {
      throw new SmartUploadCaptionGroundingError(
        "Instagram hashtags may not include unsupported clinical outcome claims.",
      );
    }
  }
}
