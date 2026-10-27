/** Conservative normalization for near-verbatim approved-claim comparison only. */
export function normalizeMedicalVerbatimText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[^a-z0-9\s%]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/g, "")
    .trim();
}

export function approvedClaimTextsEqual(a: string, b: string): boolean {
  return normalizeMedicalVerbatimText(a) === normalizeMedicalVerbatimText(b);
}
