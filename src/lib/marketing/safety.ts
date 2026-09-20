import { APPROVED_CLAIMS, RESTRICTED_CLAIMS } from "./brain";
import type { SafetyFlag } from "./types";

const MEDICAL_STAT_PATTERN =
  /\b(\d+\s?%|\d+\s+(percent|people|children|kids|patients)|1 in \d+|studies show|research shows|clinically|cure|diagnos(?:e|is)|prescribe|treatment plan)\b/i;

const TESTIMONIAL_PATTERN =
  /\b(testimonial|five stars|5 stars|#1 bestseller|as seen in|official partner|endorsed by|our patients|hospital X|school district)\b/i;

const TREATMENT_PATTERN =
  /\b(you should take|give your child|stop medication|increase dose|this will heal|guaranteed to)\b/i;

export function scanMarketingText(text: string): SafetyFlag[] {
  const flags: SafetyFlag[] = [];
  if (MEDICAL_STAT_PATTERN.test(text)) {
    flags.push({
      code: "possible_medical_statistic",
      message:
        "This copy may include a medical statistic or outcome. Only approved story facts are allowed.",
      severity: "review_required",
    });
  }
  if (TESTIMONIAL_PATTERN.test(text)) {
    flags.push({
      code: "possible_social_proof",
      message:
        "This copy may imply a testimonial, review, or partnership that is not on file.",
      severity: "review_required",
    });
  }
  if (TREATMENT_PATTERN.test(text)) {
    flags.push({
      code: "possible_treatment_advice",
      message: "This copy may read like medical advice. Marketing cannot recommend treatment.",
      severity: "review_required",
    });
  }
  if (/\b10\s?%|\bdiscount\b/i.test(text) && /\bpaperback\b|\bhardcover\b|\bamazon\b/i.test(text)) {
    flags.push({
      code: "discount_channel_mix",
      message: "Discount language appears near paperback/Amazon wording. The known 10% offer is eBook-only.",
      severity: "review_required",
    });
  }
  return flags;
}

export function approvedClaimBodies(): string[] {
  return APPROVED_CLAIMS.map((claim) => claim.body);
}

export function restrictedClaimBodies(): string[] {
  return RESTRICTED_CLAIMS;
}

export function hasSubstantiveHealthClaim(text: string): boolean {
  return scanMarketingText(text).some((flag) => flag.severity === "review_required");
}
