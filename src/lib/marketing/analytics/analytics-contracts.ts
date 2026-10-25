/**
 * PR #7 tracked-link and redirect contract (read-only reference for analytics).
 *
 * - Public link: `{site}/api/m/{trackingToken}`
 * - Redirect adds: utm_source = content.platform, utm_medium = marketing_autopilot,
 *   utm_campaign = campaignId (when set), utm_content = content.id
 * - Measured click: marketing_clicks row + content_clicked event
 */

export const UTM_MEDIUM_MARKETING_AUTOPILOT = "marketing_autopilot";

export type MeasuredAttributionDimensions = {
  /** Mirrors utm_source / publishing platform when content is known. */
  platform: string | null;
  campaignId: string | null;
  contentId: string | null;
  destinationPath: string;
};
