import { publishingScopeHintsForPlatform } from "./constants";
import type { MetaCredentialPlatform, PermissionCheckResult } from "./types";

/**
 * Scope-based publishing permission hint. A valid token with no scope list does
 * not prove publishing permission — returns `unknown`.
 */
export function evaluatePublishingPermissionCheck(
  platform: MetaCredentialPlatform,
  scopes: string[] | undefined,
  method: "meta_debug_token" | "instagram_graph_me" | "unsupported" | "not_attempted",
): PermissionCheckResult {
  if (method === "not_attempted" || method === "unsupported") {
    return "not_checked";
  }
  if (method === "instagram_graph_me") {
    return "unknown";
  }
  if (!scopes?.length) {
    return "unknown";
  }
  const normalized = new Set(scopes.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const hints = publishingScopeHintsForPlatform(platform);
  const hasHint = hints.some((hint) => normalized.has(hint.toLowerCase()));
  return hasHint ? "sufficient" : "insufficient";
}
