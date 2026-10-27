export type PublicationAmbiguityState = "none" | "ambiguous" | "owner_required";

export const PUBLICATION_AMBIGUITY_STATES: PublicationAmbiguityState[] = [
  "none",
  "ambiguous",
  "owner_required",
];

export function normalizePublicationAmbiguityState(
  state: PublicationAmbiguityState | undefined | null,
): PublicationAmbiguityState {
  return state ?? "none";
}

export function isPublicationAmbiguityBlocked(
  state: PublicationAmbiguityState | undefined | null,
): boolean {
  const normalized = normalizePublicationAmbiguityState(state);
  return normalized === "ambiguous" || normalized === "owner_required";
}
