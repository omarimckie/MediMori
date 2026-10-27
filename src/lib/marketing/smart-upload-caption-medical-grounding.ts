import { APPROVED_CLAIMS } from "./brain";
import { isWhollySafeCatalogProductReference } from "./smart-upload-caption-catalog-safe-harbor";
import { SmartUploadCaptionGroundingError } from "./smart-upload-caption-errors";
import { approvedClaimTextsEqual } from "./smart-upload-caption-medical-text";

export type ApprovedClaimRef = { id: string; body: string };

export type UsedMedicalClaimInput = { claimId: string; text: string };

export { approvedClaimTextsEqual, normalizeMedicalVerbatimText } from "./smart-upload-caption-medical-text";

export function allowedApprovedClaimsForBook(bookId: string | null): ApprovedClaimRef[] {
  const general = APPROVED_CLAIMS.filter((claim) => !claim.bookId).map((claim) => ({
    id: claim.id,
    body: claim.body,
  }));
  if (!bookId) return general;
  const bookSpecific = APPROVED_CLAIMS.filter((claim) => claim.bookId === bookId).map((claim) => ({
    id: claim.id,
    body: claim.body,
  }));
  return [...general, ...bookSpecific];
}

export function allowedApprovedClaimIdsForBook(bookId: string | null): Set<string> {
  return new Set(allowedApprovedClaimsForBook(bookId).map((claim) => claim.id));
}

function canonicalApprovedClaimBody(claimId: string): string | null {
  const row = APPROVED_CLAIMS.find((claim) => claim.id === claimId);
  return row?.body ?? null;
}

export function validateDeclaredUsedMedicalClaims(
  entries: UsedMedicalClaimInput[],
  bookId: string | null,
): ApprovedClaimRef[] {
  const allowedIds = allowedApprovedClaimIdsForBook(bookId);
  const seen = new Set<string>();
  const out: ApprovedClaimRef[] = [];

  for (const entry of entries) {
    const claimId = entry.claimId.trim();
    const text = entry.text.trim();
    if (!claimId || !text) {
      throw new SmartUploadCaptionGroundingError("Each usedMedicalClaims entry requires claimId and text.");
    }
    if (!allowedIds.has(claimId)) {
      throw new SmartUploadCaptionGroundingError(
        `Used claim id "${claimId}" is not allowed for this caption context.`,
      );
    }
    if (seen.has(claimId)) {
      throw new SmartUploadCaptionGroundingError(`Duplicate usedMedicalClaims claimId "${claimId}".`);
    }
    seen.add(claimId);

    const canonical = canonicalApprovedClaimBody(claimId);
    if (!canonical || !approvedClaimTextsEqual(text, canonical)) {
      throw new SmartUploadCaptionGroundingError(
        `usedMedicalClaims text for "${claimId}" does not match the approved claim verbatim.`,
      );
    }
    out.push({ id: claimId, body: canonical });
  }

  return out;
}

const TREATMENT_OR_DIAGNOSIS_PATTERN =
  /\b(you should take|give your child|stop medication|increase dose|this will heal|guaranteed to|prescribe|diagnosed with|use this treatment|prevent asthma attacks|prevent every attack)\b/i;

const DISEASE_OR_CONDITION_PATTERN =
  /\b(sickle\s*cell|sickle\s*cell\s*anemia|asthma|anemia|diabetes|cancer|epilepsy|disease|disorder|condition|diagnosis|prognosis)\b/i;

const SYMPTOM_OR_OUTCOME_PATTERN =
  /\b(symptom|fatigue|tired|exhausted|pain|painful|crises|crisis|cramping|weakness|unwell|organ\s+damage|complication|swelling|infection|fever|shortness of breath|wheez)\b/i;

const TREATMENT_MEDICATION_PATTERN =
  /\b(treatment|medication|medicine|medicines|inhaler|dose|prescription|therapy|clinical|hospital|emergency|er visit)\b/i;

const MECHANISM_OR_RISK_PATTERN =
  /\b(inherit|inherited|genetic|genetics|parents pass|blood cells?|red blood|sticky|prevalence|percent|studies show|\d{1,3}\s*%|risk of|can cause|may cause|causes?|leads to|results in)\b/i;

const PREVENTION_LIFESTYLE_ADVICE_PATTERN =
  /\b(prevent|prevents|prevention|cure|cures|heal|heals|lifestyle change|avoid triggers|unless medication)\b/i;

const CONTEXTUAL_PRONOUN_LEAD =
  /^(this|these|that|it|they)\b/i;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function sentenceHasExplicitMedicalIndicators(sentence: string): boolean {
  if (TREATMENT_OR_DIAGNOSIS_PATTERN.test(sentence)) return true;
  if (DISEASE_OR_CONDITION_PATTERN.test(sentence)) return true;
  if (SYMPTOM_OR_OUTCOME_PATTERN.test(sentence)) return true;
  if (TREATMENT_MEDICATION_PATTERN.test(sentence)) return true;
  if (MECHANISM_OR_RISK_PATTERN.test(sentence)) return true;
  if (PREVENTION_LIFESTYLE_ADVICE_PATTERN.test(sentence)) return true;
  return false;
}

export type MedicalSentenceScrutiny = { sentence: string; scrutinize: boolean };

/** Bounded context propagation: prior medical sentence keeps scrutiny on closely related follow-ups. */
export function medicalSentencesToScrutinize(text: string, bookId: string | null = null): MedicalSentenceScrutiny[] {
  const sentences = splitSentences(text);
  let medicalContextActive = false;
  const out: MedicalSentenceScrutiny[] = [];

  for (const sentence of sentences) {
    if (isWhollySafeCatalogProductReference(sentence, bookId)) {
      out.push({ sentence, scrutinize: false });
      medicalContextActive = false;
      continue;
    }

    const explicit = sentenceHasExplicitMedicalIndicators(sentence);
    const contextualFollowOn =
      medicalContextActive &&
      (CONTEXTUAL_PRONOUN_LEAD.test(sentence) ||
        SYMPTOM_OR_OUTCOME_PATTERN.test(sentence) ||
        MECHANISM_OR_RISK_PATTERN.test(sentence) ||
        /\b(can|may|often|sometimes)\b/i.test(sentence));

    const scrutinize = explicit || contextualFollowOn;
    out.push({ sentence, scrutinize });

    if (explicit) {
      medicalContextActive = true;
    } else if (contextualFollowOn) {
      medicalContextActive = true;
    } else if (!scrutinize) {
      medicalContextActive = false;
    }
  }

  return out;
}

export function scrutinizedMedicalSentences(text: string, bookId: string | null = null): string[] {
  return medicalSentencesToScrutinize(text, bookId)
    .filter((row) => row.scrutinize)
    .map((row) => row.sentence);
}

function sentenceIsExactDeclaredClaim(sentence: string, declaredClaims: ApprovedClaimRef[]): boolean {
  return declaredClaims.some((claim) => approvedClaimTextsEqual(sentence, claim.body));
}

export function assertCaptionFieldMedicalPolicy(
  text: string,
  declaredClaims: ApprovedClaimRef[],
  bookId: string | null,
): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  const medicalSentences = scrutinizedMedicalSentences(trimmed, bookId);
  const requiringGrounding = medicalSentences.filter(
    (sentence) => !isWhollySafeCatalogProductReference(sentence, bookId),
  );

  if (requiringGrounding.length === 0) {
    return;
  }

  if (declaredClaims.length === 0) {
    throw new SmartUploadCaptionGroundingError(
      "Caption contains substantive medical factual content without verbatim approved claims.",
    );
  }

  for (const sentence of requiringGrounding) {
    if (!sentenceIsExactDeclaredClaim(sentence, declaredClaims)) {
      throw new SmartUploadCaptionGroundingError(
        "Caption medical factual content must appear as an exact approved claim sentence.",
      );
    }
  }
}

export function assertCaptionFieldsMedicalPolicy(
  fields: Array<string | null | undefined>,
  declaredClaims: ApprovedClaimRef[],
  bookId: string | null,
): void {
  for (const field of fields) {
    if (field?.trim()) {
      assertCaptionFieldMedicalPolicy(field, declaredClaims, bookId);
    }
  }
}

/** @deprecated Use scrutinizedMedicalSentences / assertCaptionFieldMedicalPolicy */
export function textHasSubstantiveMedicalFactualContent(text: string): boolean {
  return scrutinizedMedicalSentences(text).length > 0;
}

/** @deprecated */
export function assertMedicalGroundingForCaptionText(
  text: string,
  _usedClaimIds: string[],
  bookId: string | null,
): void {
  assertCaptionFieldMedicalPolicy(text, [], bookId);
}

/** @deprecated */
export function validateUsedClaimIdsSubset(usedClaimIds: string[], bookId: string | null): ApprovedClaimRef[] {
  const allowed = allowedApprovedClaimsForBook(bookId);
  const allowedIds = new Set(allowed.map((claim) => claim.id));
  for (const id of usedClaimIds) {
    if (!allowedIds.has(id.trim())) {
      throw new SmartUploadCaptionGroundingError(
        `Used claim id "${id}" is not allowed for this caption context.`,
      );
    }
  }
  return allowed.filter((claim) => usedClaimIds.includes(claim.id));
}
