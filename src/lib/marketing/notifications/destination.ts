const DEFAULT_MARKETING_ADMIN_DESTINATION = "/admin/marketing";

/** Admin-only in-app destinations for notification clicks (no external URLs). */
export function normalizeMarketingNotificationDestination(
  destination: string | null | undefined,
): string {
  const raw = destination?.trim() || DEFAULT_MARKETING_ADMIN_DESTINATION;
  if (!raw.startsWith("/")) {
    return DEFAULT_MARKETING_ADMIN_DESTINATION;
  }
  if (raw.startsWith("//")) {
    return DEFAULT_MARKETING_ADMIN_DESTINATION;
  }
  if (raw.includes("://")) {
    return DEFAULT_MARKETING_ADMIN_DESTINATION;
  }
  if (!raw.startsWith("/admin/marketing")) {
    return DEFAULT_MARKETING_ADMIN_DESTINATION;
  }
  return raw.split("?")[0].split("#")[0];
}

export function isValidMarketingNotificationDestination(destination: string): boolean {
  const normalized = normalizeMarketingNotificationDestination(destination);
  return normalized === destination.trim().split("?")[0].split("#")[0];
}
