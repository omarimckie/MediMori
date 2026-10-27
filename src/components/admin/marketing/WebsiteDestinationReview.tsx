import type { MarketingWebsiteDestinationReview } from "@/lib/marketing/marketing-website-destination";

type Props = {
  review: MarketingWebsiteDestinationReview;
};

export function WebsiteDestinationReview({ review }: Props) {
  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-brand-brown/15 bg-cream-deep/50 p-3 text-xs text-brand-charcoal/75">
      <p className="font-bold uppercase tracking-wide text-brand-green-deep">Website destination</p>
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
        <p className="font-semibold text-brand-orange-deep">No tracked link (missing tracking token).</p>
      )}
      <p>
        <span className="font-semibold text-brand-charcoal">Platform behavior:</span>{" "}
        {review.platformNavigationSummary}
      </p>
      {review.warnings.length ? (
        <ul className="list-disc pl-4 text-brand-orange-deep">
          {review.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
