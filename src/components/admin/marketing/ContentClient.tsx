"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { pickOperationalWeeklyPlanId } from "@/lib/marketing/content-client-utils";
import {
  formatAddToPlannerSuccessMessage,
  parseAddToPlannerResponse,
} from "@/lib/marketing/content-planner-client";
import { AddToPlannerModal } from "./AddToPlannerModal";
import {
  ContentQueueReviewCard,
  type ContentQueueReviewItem,
} from "./ContentQueueReviewCard";
import { Card, SecondaryButton } from "./ui";

type WeeklyPlanOption = {
  id: string;
  weekStart: string;
};

type PreviewById = Record<
  string,
  {
    previewUrl: string | null;
    showVisualPreview: boolean;
    websiteDestination?: import("@/lib/marketing/marketing-website-destination").MarketingWebsiteDestinationReview;
  }
>;

export function ContentClient() {
  const [items, setItems] = useState<ContentQueueReviewItem[]>([]);
  const [previewByContentId, setPreviewByContentId] = useState<PreviewById>({});
  const [plans, setPlans] = useState<WeeklyPlanOption[]>([]);
  const [currentWeekPlanId, setCurrentWeekPlanId] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    status: "",
    platform: "",
    category: "",
    audience: "",
  });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [plannerModal, setPlannerModal] = useState<ContentQueueReviewItem | null>(null);
  const [allowPublicBlobPreview, setAllowPublicBlobPreview] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    params.set("enrich", "preview");
    try {
      const [contentRes, settingsRes] = await Promise.all([
        fetch(`/api/admin/marketing/content?${params}`),
        fetch("/api/admin/marketing/settings"),
      ]);
      const data = (await contentRes.json()) as {
        content?: ContentQueueReviewItem[];
        previewByContentId?: PreviewById;
        previewReadonlyImages?: boolean;
        error?: string;
      };
      if (!contentRes.ok) {
        throw new Error(data.error || "Could not load content.");
      }
      setItems(data.content ?? []);
      setPreviewByContentId(data.previewByContentId ?? {});
      setAllowPublicBlobPreview(data.previewReadonlyImages === true);
      if (settingsRes.ok) {
        const settings = (await settingsRes.json()) as { plans?: WeeklyPlanOption[] };
        const planList = settings.plans ?? [];
        setPlans(planList);
        setCurrentWeekPlanId(pickOperationalWeeklyPlanId(planList));
      }
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error: Error) => setMessage(error.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function confirmAddToPlanner(input: { contentIds: string[] }) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/marketing/content/add-to-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentIds: input.contentIds }),
      });
      const json = (await res.json()) as { error?: string; ok?: boolean; queued?: string[]; alreadyQueued?: string[] };
      if (!res.ok) {
        setMessage(json.error ?? "Could not add to planner.");
        return;
      }
      const parsed = parseAddToPlannerResponse(json);
      if (!parsed) {
        setMessage("Unexpected planner response.");
        return;
      }
      setPlannerModal(null);
      setMessage(formatAddToPlannerSuccessMessage(parsed.queued, parsed.alreadyQueued));
      await load();
    } catch {
      setMessage("Network error while adding to planner.");
    } finally {
      setBusy(false);
    }
  }

  async function runReviewAction(
    contentId: string,
    body: { action: "approve" | "reject"; feedback?: string },
  ) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/marketing/content/${contentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(json.error ?? "Review action failed.");
        return;
      }
      setMessage(
        body.action === "approve"
          ? "Approved. Use Add to Planner when you are ready to queue for scheduling."
          : "Rejected.",
      );
      await load();
    } catch {
      setMessage("Network error while updating review status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-brand-charcoal/70">
          Review marketing content with authenticated image previews and full captions. Approving
          marks a post ready for the planner — it does not schedule or publish. Add approved items to
          the{" "}
          <Link href="/admin/marketing/calendar#planning-queue" className="font-bold text-brand-navy underline">
            planning queue
          </Link>{" "}
          to choose week, platform, and publish time later.{" "}
          <Link href="/admin/marketing/week" className="font-bold text-brand-navy underline">
            Your week
          </Link>{" "}
          remains the working queue when you assign content to a weekly plan.
        </p>
      </Card>

      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["status", ["", "draft", "needs_review", "approved", "rejected", "scheduled", "published", "failed"]],
            ["platform", ["", "instagram", "facebook", "pinterest", "email", "website", "google"]],
            ["category", ["", "educational", "brand_story", "product_feature", "engagement", "trust", "conversion", "community"]],
            ["audience", ["", "parents", "hospitals", "schools", "libraries"]],
          ].map(([name, options]) => (
            <label key={String(name)} className="text-xs font-bold uppercase text-brand-charcoal/60">
              {String(name)}
              <select
                className="mt-1 w-full rounded-xl border border-brand-brown/20 p-2 text-sm font-semibold text-brand-charcoal"
                value={filters[name as keyof typeof filters]}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, [name as string]: event.target.value }))
                }
              >
                {(options as string[]).map((option) => (
                  <option key={option} value={option}>
                    {option || "all"}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </Card>

      {message ? (
        <p className="text-sm font-semibold text-brand-orange-deep" role="status">
          {message}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-brand-charcoal/60" role="status">
          Loading content…
        </p>
      ) : null}

      {!loading &&
        items.map((item) => {
          const preview = previewByContentId[item.id];
          return (
            <ContentQueueReviewCard
              key={item.id}
              item={item}
              previewUrl={preview?.previewUrl ?? null}
              showVisualPreview={preview?.showVisualPreview ?? false}
              websiteDestination={preview?.websiteDestination ?? null}
              allowPublicBlobPreview={allowPublicBlobPreview}
              plans={plans}
              currentWeekPlanId={currentWeekPlanId}
              busy={busy}
              onApprove={() => void runReviewAction(item.id, { action: "approve" })}
              onReject={() =>
                void runReviewAction(item.id, {
                  action: "reject",
                  feedback: "Rejected from content queue.",
                })
              }
              onAddToPlanner={() => setPlannerModal(item)}
            />
          );
        })}

      {!loading && !items.length ? (
        <p className="text-sm text-brand-charcoal/60">No content matches these filters.</p>
      ) : null}

      <SecondaryButton onClick={() => void load()} disabled={busy || loading}>
        Refresh
      </SecondaryButton>

      {plannerModal ? (
        <AddToPlannerModal
          open
          busy={busy}
          anchorContentId={plannerModal.id}
          anchorTitle={plannerModal.title}
          anchorBody={plannerModal.body}
          previewUrl={previewByContentId[plannerModal.id]?.previewUrl ?? null}
          allowPublicBlobPreview={allowPublicBlobPreview}
          onClose={() => setPlannerModal(null)}
          onConfirm={(input) => void confirmAddToPlanner(input)}
        />
      ) : null}
    </div>
  );
}
