import { isContentRecyclablePlatform } from "./recycle-eligibility";
import type { MarketingContent } from "./types";

export type CalendarAddExistingMode = "schedule" | "recycle";

export type CalendarAddExistingEligibilityInput = {
  status: string;
  platform: MarketingContent["platform"];
  format: MarketingContent["format"];
  hasPublishedPublication: boolean;
};

export type CalendarAddExistingEligibility =
  | { eligible: true; mode: CalendarAddExistingMode; hint: string }
  | { eligible: false; reason: string };

/** Client-safe eligibility for Calendar → Add Existing Post (API re-validates). */
export function calendarAddExistingEligibility(
  input: CalendarAddExistingEligibilityInput,
): CalendarAddExistingEligibility {
  if (input.status === "needs_review") {
    return {
      eligible: false,
      reason: "Approve this post from Your week before scheduling.",
    };
  }
  if (input.status === "rejected") {
    return { eligible: false, reason: "Rejected content cannot be scheduled." };
  }
  if (input.status === "failed") {
    return {
      eligible: false,
      reason: "Only approved or scheduled content can be scheduled.",
    };
  }
  if (input.status === "draft" || input.status === "archived") {
    return { eligible: false, reason: "This content is not available for scheduling." };
  }
  if (input.status === "published" || input.status === "scheduled") {
    if (
      input.hasPublishedPublication &&
      isContentRecyclablePlatform(input)
    ) {
      return {
        eligible: true,
        mode: "recycle",
        hint: "Creates a new scheduled publication (recycle).",
      };
    }
    if (input.status === "published") {
      if (!isContentRecyclablePlatform(input)) {
        return { eligible: false, reason: "This content type cannot be recycled." };
      }
      return {
        eligible: false,
        reason: "No published publication found for this content.",
      };
    }
    if (input.status === "scheduled") {
      return {
        eligible: true,
        mode: "schedule",
        hint: "Schedules this post for publishing.",
      };
    }
  }
  if (input.status === "approved") {
    return {
      eligible: true,
      mode: "schedule",
      hint: "Schedules this post for publishing.",
    };
  }
  return { eligible: false, reason: "This content cannot be scheduled." };
}

export function contentMatchesAddExistingSearch(
  item: Pick<MarketingContent, "title" | "body" | "platform">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const title = (item.title ?? "").toLowerCase();
  const body = item.body.toLowerCase();
  const platform = item.platform.toLowerCase();
  return title.includes(q) || body.includes(q) || platform.includes(q);
}
