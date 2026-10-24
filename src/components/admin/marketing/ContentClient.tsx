"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { pickOperationalWeeklyPlanId } from "@/lib/marketing/content-client-utils";
import { AddToWeekModal } from "./AddToWeekModal";
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
  const [message, setMessage] = useState<string | null>(null);
  const [weekModal, setWeekModal] = useState<ContentQueueReviewItem | null>(null);
  const [allowPublicBlobPreview, setAllowPublicBlobPreview] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    params.set("enrich", "preview");
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
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error: Error) => setMessage(error.message));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function confirmAssignWeek(input: { weeklyPlanId: string; contentIds: string[] }) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/marketing/content/assign-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(json.error ?? "Could not assign to week.");
        return;
      }
      setWeekModal(null);
      setMessage("Assigned to week.");
      await load();
    } catch {
      setMessage("Network error while assigning to week.");
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
      setMessage(body.action === "approve" ? "Approved. Not scheduled or published." : "Rejected.");
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
          marks a post ready for later scheduling — it does not schedule or publish. Assign items to
          a weekly plan for{" "}
          <Link href="/admin/marketing/week" className="font-bold text-brand-navy underline">
            Your week
          </Link>{" "}
          when that plan is active.
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

      {items.map((item) => {
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
            onAddToWeek={() => setWeekModal(item)}
          />
        );
      })}

      {!items.length ? (
        <p className="text-sm text-brand-charcoal/60">No content matches these filters.</p>
      ) : null}

      <SecondaryButton onClick={() => void load()}>Refresh</SecondaryButton>

      {weekModal ? (
        <AddToWeekModal
          open
          busy={busy}
          anchorContentId={weekModal.id}
          anchorTitle={weekModal.title}
          anchorBody={weekModal.body}
          previewUrl={previewByContentId[weekModal.id]?.previewUrl ?? null}
          allowPublicBlobPreview={allowPublicBlobPreview}
          plans={plans}
          initialWeeklyPlanId={
            weekModal.weeklyPlanId ?? pickOperationalWeeklyPlanId(plans)
          }
          onClose={() => setWeekModal(null)}
          modalTitle={weekModal.weeklyPlanId ? "Change Week" : "Add to Week"}
          confirmLabel={weekModal.weeklyPlanId ? "Save week" : "Add to Week"}
          onConfirm={(input) => void confirmAssignWeek(input)}
        />
      ) : null}
    </div>
  );
}
