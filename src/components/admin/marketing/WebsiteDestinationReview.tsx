import type { MarketingWebsiteDestinationReview } from "@/lib/marketing/marketing-website-destination";

type Props = {
  review: MarketingWebsiteDestinationReview;
};

const READINESS_LABEL: Record<MarketingWebsiteDestinationReview["readiness"], string> = {
  ready: "Ready",
  warning: "Review recommended",
  blocked: "Blocked for schedule/publish",
};

const READINESS_CLASS: Record<MarketingWebsiteDestinationReview["readiness"], string> = {
  ready: "text-brand-green-deep",
  warning: "text-brand-orange-deep",
  blocked: "text-red-700",
};

const LINK_BEHAVIOR_LABEL: Record<
  MarketingWebsiteDestinationReview["platformLinkBehavior"],
  string
> = {
  clickable_destination: "Clickable pin destination",
  feed_link_field: "Clickable feed link (text post)",
  caption_text_only: "Caption text only (not a tappable link)",
};

export function WebsiteDestinationReview({ review }: Props) {
  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-brand-brown/15 bg-cream-deep/50 p-3 text-xs text-brand-charcoal/75">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-bold uppercase tracking-wide text-brand-green-deep">Website destination</p>
        <span
          className={`rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${READINESS_CLASS[review.readiness]}`}
        >
          {READINESS_LABEL[review.readiness]}
        </span>
        {review.grandfatheredWithoutTrackedLink ? (
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-brand-charcoal/60">
            Grandfathered (no token)
          </span>
        ) : null}
      </div>
      <p>
        <span className="font-semibold text-brand-charcoal">On-site page:</span>{" "}
        <code className="rounded bg-white/60 px-1 py-0.5">{review.destinationPath}</code>
        <span className="text-brand-charcoal/50"> ({review.sitePageUrl})</span>
      </p>
      {review.trackingLink ? (
        <p className="break-all">
          <span className="font-semibold text-brand-charcoal">Tracked link:</span> {review.trackingLink}
        </p>
      ) : (
        <p className="font-semibold text-brand-orange-deep">
          No tracked link
          {review.trackingTokenPresent ? " (could not build /api/m URL)." : " (missing tracking token)."}
        </p>
      )}
      <p>
        <span className="font-semibold text-brand-charcoal">Link on platform:</span>{" "}
        {LINK_BEHAVIOR_LABEL[review.platformLinkBehavior]}
      </p>
      <p>
        <span className="font-semibold text-brand-charcoal">Platform behavior:</span>{" "}
        {review.platformNavigationSummary}
      </p>
      {review.publishBlocked ? (
        <p className="font-semibold text-red-700">
          Schedule and publish preflight will block this row until tracking and destination issues are fixed.
        </p>
      ) : null}
      {review.issues.length ? (
        <ul className="space-y-1">
          {review.issues.map((issue) => (
            <li
              key={issue.code}
              className={
                issue.severity === "error"
                  ? "text-red-700"
                  : issue.severity === "warning"
                    ? "text-brand-orange-deep"
                    : "text-brand-charcoal/65"
              }
            >
              <span className="font-semibold">{issue.severity}:</span> {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      {review.recoveryHints.length ? (
        <div className="rounded-xl border border-brand-brown/10 bg-white/50 p-2 text-brand-charcoal/80">
          <p className="font-semibold text-brand-charcoal">Recovery</p>
          <ul className="list-disc pl-4">
            {review.recoveryHints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
