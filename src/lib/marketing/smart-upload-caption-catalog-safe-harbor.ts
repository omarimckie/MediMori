import { catalogBooks, catalogCharacters } from "./brain";
import { normalizeMedicalVerbatimText } from "./smart-upload-caption-medical-text";

const PRODUCT_ACTION_PATTERN =
  /\b(read|explore|discover|find|meet|shop|browse|learn more|check out|get|view)\b/i;

const PRODUCT_NOUN_PATTERN =
  /\b(book|books|story|stories|title|titles|series|resource|resources|children'?s book|children'?s story)\b/i;

/** Clinical factual language beyond catalog subject positioning. */
const CLINICAL_FACTUAL_ASSERTION_PATTERN =
  /\b(causes?|can cause|may cause|could cause|leads to|results in|affects?\s+red\s+blood|inherited|inheritance|genetic|genetics|organ damage|painful crises|painful crisis|experience(?:s)?\s+fatigue|\d{1,3}\s*%|percent|studies show|cure|cures|cured|heals|heal|treatment prevents|inhalers?\s+prevent|prevents?\s+(every|all)?\s*asthma|prevents?\s+attacks|diagnosed with|prognosis|children with asthma may)\b/i;

const MIXED_PRODUCT_MEDICAL_CLAUSE_PATTERN =
  /\b(because|where you(?:'ll)?\s+learn|to learn (?:why|how)|,\s*where|—\s*\d|—\s*(?:sickle|asthma|the disease))\b/i;

const ABOUT_HOW_ASSERTION_PATTERN = /\babout\s+how\b/i;

const SHOWS_CLINICAL_PATTERN =
  /\b(shows?|showing|demonstrates?|explains? how|teaches? (?:you |readers )?(?:that |how ))\b/i;

let catalogPhraseLexiconCache: Set<string> | null = null;

function catalogPhraseLexicon(): Set<string> {
  if (catalogPhraseLexiconCache) return catalogPhraseLexiconCache;
  const phrases = new Set<string>();
  for (const book of catalogBooks()) {
    phrases.add(normalizeMedicalVerbatimText(book.title));
    const afterColon = book.title.split(":")[1]?.trim();
    if (afterColon) phrases.add(normalizeMedicalVerbatimText(afterColon));
    if (book.id === "book-one") {
      phrases.add("sickle cell");
      phrases.add("sickle cell disease");
      phrases.add("sickle cell anemia");
    }
    if (book.id === "book-three") {
      phrases.add("asthma");
      phrases.add(normalizeMedicalVerbatimText("AJ Can Breathe Easy"));
    }
    if (book.id === "book-two") {
      phrases.add(normalizeMedicalVerbatimText("Health & Medicine Word Search Collection"));
    }
  }
  phrases.add("children diseases");
  for (const character of catalogCharacters()) {
    phrases.add(normalizeMedicalVerbatimText(character.name));
  }
  catalogPhraseLexiconCache = phrases;
  return phrases;
}

export function defaultBookContextCtaPhrases(): string[] {
  return catalogBooks().map(
    (book) => normalizeMedicalVerbatimText(`Read ${book.title} on twilight-feather.com`),
  );
}

export function sentenceContainsClinicalFactualAssertion(sentence: string): boolean {
  if (ABOUT_HOW_ASSERTION_PATTERN.test(sentence)) return true;
  if (MIXED_PRODUCT_MEDICAL_CLAUSE_PATTERN.test(sentence)) return true;
  if (SHOWS_CLINICAL_PATTERN.test(sentence) && CLINICAL_FACTUAL_ASSERTION_PATTERN.test(sentence)) {
    return true;
  }
  if (SHOWS_CLINICAL_PATTERN.test(sentence) && /\b(inhaler|prevent|cause|treat|attack|damage)\b/i.test(sentence)) {
    return true;
  }
  return CLINICAL_FACTUAL_ASSERTION_PATTERN.test(sentence);
}

function referencesCatalogPhrase(normalizedSentence: string): boolean {
  const lexicon = catalogPhraseLexicon();
  for (const phrase of lexicon) {
    if (phrase.length < 3) continue;
    if (normalizedSentence.includes(phrase)) return true;
  }
  if (
    normalizedSentence.includes("sickle cell") &&
    normalizedSentence.includes("asthma") &&
    normalizedSentence.includes("book")
  ) {
    return true;
  }
  return false;
}

function hasProductPositioningSignal(normalizedSentence: string): boolean {
  if (PRODUCT_ACTION_PATTERN.test(normalizedSentence)) return true;
  if (PRODUCT_NOUN_PATTERN.test(normalizedSentence) && referencesCatalogPhrase(normalizedSentence)) {
    return true;
  }
  if (/\bmeet\s+\w+/.test(normalizedSentence) && referencesCatalogPhrase(normalizedSentence)) {
    return true;
  }
  if (/\babout\s+(our\s+)?/.test(normalizedSentence) && referencesCatalogPhrase(normalizedSentence)) {
    return true;
  }
  if (normalizedSentence.includes("twilight-feather.com") && referencesCatalogPhrase(normalizedSentence)) {
    return true;
  }
  return false;
}

/**
 * Whole-sentence catalog/product reference without unsupported clinical factual assertions.
 * Server-owned catalog metadata only.
 */
export function isWhollySafeCatalogProductReference(sentence: string, bookId: string | null): boolean {
  const trimmed = sentence.trim();
  if (!trimmed) return false;

  const normalized = normalizeMedicalVerbatimText(trimmed);
  if (bookId) {
    const book = catalogBooks().find((b) => b.id === bookId);
    if (
      book &&
      normalized === normalizeMedicalVerbatimText(`Read ${book.title} on twilight-feather.com`)
    ) {
      return true;
    }
  }
  for (const cta of defaultBookContextCtaPhrases()) {
    if (normalized === cta) return true;
  }

  if (sentenceContainsClinicalFactualAssertion(trimmed)) {
    return false;
  }

  if (!referencesCatalogPhrase(normalized)) {
    return false;
  }

  return hasProductPositioningSignal(normalized);
}
