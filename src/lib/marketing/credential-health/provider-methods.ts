import type { CredentialValidationMethod, MetaCredentialPlatform } from "./types";

export type ProviderValidationCapability = {
  platform: MetaCredentialPlatform;
  /** Primary read-only method for scheduled probes (later B3 stages). */
  supportedProbeMethod: CredentialValidationMethod;
  graphHost: string;
  requiresAppIdAndSecret: boolean;
  expirationMetadataAvailable: "yes" | "partial" | "no";
  notes: string;
};

/**
 * Documented provider compatibility (no live calls). Facebook Page tokens are
 * introspected via `GET graph.facebook.com/{version}/debug_token` using an app
 * access token (`app_id|app_secret`) or developer user token for the same app.
 *
 * Instagram tokens used by `InstagramPublisher` call `graph.instagram.com`.
 * Instagram Login / Business Login tokens are validated read-only via
 * `GET graph.instagram.com/{version}/me` (identity check only). They are not
 * interchangeable with `debug_token` on `graph.facebook.com` for all token
 * types — treat `meta_debug_token` as unsupported for Instagram Login tokens.
 */
export const META_CREDENTIAL_VALIDATION_CAPABILITIES: readonly ProviderValidationCapability[] =
  [
    {
      platform: "facebook",
      supportedProbeMethod: "meta_debug_token",
      graphHost: "graph.facebook.com",
      requiresAppIdAndSecret: true,
      expirationMetadataAvailable: "partial",
      notes:
        "Page tokens may report expires_at=0 (non-expiring) but can still be invalidated early.",
    },
    {
      platform: "instagram",
      supportedProbeMethod: "instagram_graph_me",
      graphHost: "graph.instagram.com",
      requiresAppIdAndSecret: false,
      expirationMetadataAvailable: "no",
      notes:
        "/me confirms token validity and user id; does not return scopes or prove content-publish permission.",
    },
  ];

export function supportedProbeMethodForPlatform(
  platform: MetaCredentialPlatform,
): CredentialValidationMethod {
  const row = META_CREDENTIAL_VALIDATION_CAPABILITIES.find((c) => c.platform === platform);
  return row?.supportedProbeMethod ?? "unsupported";
}
