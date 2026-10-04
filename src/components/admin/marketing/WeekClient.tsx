"use client";

import { useEffect, useMemo, useState } from "react";
import { pickPrimaryPublication } from "@/lib/marketing/publication-selection";
import { formatPublicationStatusLabel, publishDueButtonLabel } from "@/lib/marketing/publication-display";
import type { MarketingPublication } from "@/lib/marketing/types";
import type { WeeklyItemReview } from "@/lib/marketing/weekly-review";
import { runMarketingWeekPostAction } from "./week-client-act";
import { WeeklyVisualPreview } from "./WeeklyVisualPreview";
import { UploadPostModal, UploadResourceModal } from "./ManualUploadModals";
import { ContentReviewCardActions, reviewScheduleModalState } from "./ContentReviewCardActions";
import { ScheduleContentModal } from "./ScheduleContentModal";
import {
  PERMANENT_DELETE_CONFIRMATION,
  WEEK_WORKING_QUEUE_EXCLUDE_STATUSES,
} from "@/lib/marketing/content-week-queue";
import {
  EMPTY_WEEK_MESSAGE,
  formatWeekPlanSelectorLabel,
  resolveWeeklyPlanSelection,
  weekPlanTiming,
} from "@/lib/marketing/content-client-utils";
import { formatMarketingWeekTimingLabel, nextMondayDefault } from "@/lib/marketing/weekly-plan-dates";
import { NewWeekModal } from "./NewWeekModal";
import { Card, PrimaryButton, SecondaryButton, StatusPill } from "./ui";
import Link from "next/link";

type ContentItem = {
  id: string;
  campaignId: string | null;
  weeklyPlanId: string | null;
  platform: string;
  format: string;
  category: string;
  audience: string;
  status: string;
  title: string | null;
  body: string;
  cta: string | null;
  warnings: string[];
  needsNewAsset: boolean;
  scheduledFor: string | null;
  trackingToken: string | null;
  bookId: string | null;
};

type PublicationRow = Pick<
  MarketingPublication,
  "id" | "contentId" | "platform" | "provider" | "status" | "createdAt"
>;

type Settings = {
  mockMode?: boolean;
  pinterestLiveConfigured?: boolean;
  marketingTimezone?: string;
  publications?: PublicationRow[];
  plans: Array<{
    id: string;
    weekStart: string;
    status: string;
    campaignId: string | null;
    summary: {
      itemCount: number;
      newAssetCount: number;
      warningCount: number;
      objective: string;
      audience: string;
    };
  }>;
};

export function WeekClient() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [reviewByContentId, setReviewByContentId] = useState<Record<string, WeeklyItemReview>>(
    {},
  );
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showUploadPost, setShowUploadPost] = useState(false);
  const [showUploadResource, setShowUploadResource] = useState(false);
  const [scheduleItem, setScheduleItem] = useState<ContentItem | null>(null);
  const [recycleItem, setRecycleItem] = useState<ContentItem | null>(null);
  const [rejectedContent, setRejectedContent] = useState<ContentItem[]>([]);
  const [rejectedReviewByContentId, setRejectedReviewByContentId] = useState<
    Record<string, WeeklyItemReview>
  >({});
  const [rejectionFeedbackByContentId, setRejectionFeedbackByContentId] = useState<
    Record<string, string | null>
  >({});
  const [showRejectedHistory, setShowRejectedHistory] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [showNewWeek, setShowNewWeek] = useState(false);
  const [newWeekSession, setNewWeekSession] = useState(0);

  function openNewWeekModal() {
    setNewWeekSession((value) => value + 1);
    setShowNewWeek(true);
    setMessage(null);
  }

  const plan =
    settings?.plans.find((row) => row.id === selectedPlanId) ?? settings?.plans[0];
  const mockMode = settings?.mockMode ?? true;
  const pinterestLiveConfigured = settings?.pinterestLiveConfigured ?? false;
  const marketingTimezone = settings?.marketingTimezone ?? "America/New_York";
  const publicationByContent = useMemo(() => {
    const map = new Map<string, PublicationRow>();
    const publications = settings?.publications ?? [];
    const contentIds = new Set(publications.map((row) => row.contentId));
    for (const contentId of contentIds) {
      const primary = pickPrimaryPublication(publications, contentId);
      if (primary) map.set(contentId, primary);
    }
    return map;
  }, [settings?.publications]);

  async function load(preferredPlanId?: string | null) {
    const settingsData = (await fetch("/api/admin/marketing/settings").then((res) => res.json())) as Settings;
    setSettings(settingsData);
    const keep = resolveWeeklyPlanSelection(settingsData.plans, {
      preferredPlanId,
      currentSelectedId: selectedPlanId,
    });
    setSelectedPlanId(keep);
    const planId = keep ?? settingsData.plans[0]?.id;
    const excludeStatus = WEEK_WORKING_QUEUE_EXCLUDE_STATUSES.join(",");
    const activeQuery = planId
      ? `?weeklyPlanId=${planId}&enrich=weekly&excludeStatus=${excludeStatus}`
      : `?enrich=weekly&excludeStatus=${excludeStatus}`;
    const rejectedQuery = planId
      ? `?weeklyPlanId=${planId}&enrich=weekly&status=rejected`
      : "?enrich=weekly&status=rejected";
    const [activeData, rejectedData] = await Promise.all([
      fetch(`/api/admin/marketing/content${activeQuery}`).then((res) => res.json()),
      planId
        ? fetch(`/api/admin/marketing/content${rejectedQuery}`).then((res) => res.json())
        : Promise.resolve({ content: [], reviewByContentId: {}, rejectionFeedbackByContentId: {} }),
    ]);
    setContent(activeData.content ?? []);
    setReviewByContentId(activeData.reviewByContentId ?? {});
    setRejectedContent(rejectedData.content ?? []);
    setRejectedReviewByContentId(rejectedData.reviewByContentId ?? {});
    setRejectionFeedbackByContentId(rejectedData.rejectionFeedbackByContentId ?? {});
  }

  async function restoreRejected(contentId: string) {
    await act(`/api/admin/marketing/content/${contentId}`, { action: "restore" });
  }

  async function permanentlyDeleteRejected(item: ContentItem) {
    const confirmed = window.confirm(
      `Permanently delete "${item.title ?? item.platform}"?\n\nThis cannot be undone. The content will be removed from marketing history.`,
    );
    if (!confirmed) return;
    await act(`/api/admin/marketing/content/${item.id}`, {
      action: "delete_permanent",
      confirmPermanentDelete: PERMANENT_DELETE_CONFIRMATION,
    });
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, ContentItem[]>();
    for (const item of content) {
      const list = map.get(item.platform) ?? [];
      list.push(item);
      map.set(item.platform, list);
    }
    return map;
  }, [content]);

  async function act(path: string, body: unknown) {
    setBusy(true);
    setMessage(null);
    try {
      const errorMessage = await runMarketingWeekPostAction(path, body, fetch, load);
      if (errorMessage) setMessage(errorMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <Card>
        <p>Loading this week’s package…</p>
      </Card>
    );
  }

  if (!plan) {
    return (
      <div className="space-y-4">
        <Card>
          <p className="text-sm text-brand-charcoal/80">
            No weekly plans yet. Create an empty planning week, or generate a campaign package from
            Campaigns.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <PrimaryButton type="button" onClick={openNewWeekModal}>
              New Week
            </PrimaryButton>
            <Link
              href="/admin/marketing/campaigns"
              className="inline-flex h-10 items-center rounded-xl border border-brand-brown/20 bg-white px-4 text-sm font-bold text-brand-charcoal"
            >
              Campaigns
            </Link>
          </div>
        </Card>
        {showNewWeek ? (
          <NewWeekModal
            key={newWeekSession}
            busy={busy}
            initialWeekStart={nextMondayDefault()}
            onClose={() => setShowNewWeek(false)}
            onCreated={(planId) => void load(planId)}
            setMessage={setMessage}
          />
        ) : null}
        {message ? <p className="text-sm font-semibold text-brand-orange-deep">{message}</p> : null}
      </div>
    );
  }

  const weekTiming = weekPlanTiming(plan.weekStart);

  return (
    <div className="space-y-6">
      <Card className="bg-brand-navy text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-brand-gold">
              {formatMarketingWeekTimingLabel(weekTiming)} week
            </p>
            <h2 className="mt-2 font-display text-3xl">Week of {plan.weekStart}</h2>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            {settings.plans.length > 1 ? (
              <label className="text-xs font-bold uppercase tracking-wide text-white/70">
                View week
                <select
                  className="mt-1 block min-w-[14rem] rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-white"
                  value={plan.id}
                  disabled={busy}
                  onChange={(event) => {
                    setSelectedPlanId(event.target.value);
                    void load(event.target.value);
                  }}
                >
                  {settings.plans.map((row) => (
                    <option key={row.id} value={row.id} className="text-brand-charcoal">
                      {formatWeekPlanSelectorLabel(row.weekStart)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <SecondaryButton
              disabled={busy}
              onClick={openNewWeekModal}
              className="border-white/30 text-white hover:bg-white/10"
            >
              New Week
            </SecondaryButton>
          </div>
        </div>
        <p className="mt-2 text-white/80">{plan.summary.objective}</p>
        <p className="mt-3 text-sm">
          {plan.summary.itemCount} items · {plan.summary.newAssetCount} need new assets ·{" "}
          {plan.summary.warningCount} with warnings · audience: {plan.summary.audience}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void act("/api/admin/marketing/week", { action: "approve_all", weeklyPlanId: plan.id })}
            className="inline-flex h-10 items-center rounded-xl bg-brand-gold px-4 text-sm font-bold text-brand-navy"
          >
            Approve all
          </button>
          <SecondaryButton
            disabled={busy}
            onClick={() =>
              void act("/api/admin/marketing/week", {
                action: "reject_all",
                weeklyPlanId: plan.id,
                feedback: "Rejected from weekly package.",
              })
            }
          >
            Reject all
          </SecondaryButton>
          <SecondaryButton
            disabled={busy}
            onClick={() => void act("/api/cron/marketing-publish", {})}
          >
            {publishDueButtonLabel(mockMode, pinterestLiveConfigured)}
          </SecondaryButton>
          <SecondaryButton disabled={busy} onClick={() => setShowUploadPost(true)}>
            Upload post
          </SecondaryButton>
          <SecondaryButton disabled={busy} onClick={() => setShowUploadResource(true)}>
            Upload free resource
          </SecondaryButton>
        </div>
      </Card>
      {showUploadPost ? (
        <UploadPostModal
          weeklyPlanId={plan.id}
          busy={busy}
          onClose={() => setShowUploadPost(false)}
          onDone={load}
          setMessage={setMessage}
        />
      ) : null}
      {showUploadResource ? (
        <UploadResourceModal
          weeklyPlanId={plan.id}
          busy={busy}
          onClose={() => setShowUploadResource(false)}
          onDone={load}
          setMessage={setMessage}
        />
      ) : null}
      {(() => {
        const modal = reviewScheduleModalState(scheduleItem, recycleItem);
        if (!modal) return null;
        return (
          <ScheduleContentModal
            mode={modal.mode}
            title={modal.item.title}
            platform={modal.item.platform}
            marketingTimezone={marketingTimezone}
            initialScheduledFor={modal.item.scheduledFor}
            busy={busy}
            onClose={() => {
              setScheduleItem(null);
              setRecycleItem(null);
            }}
            onConfirm={(scheduledFor) => {
              const contentId = modal.item.id;
              setScheduleItem(null);
              setRecycleItem(null);
              void act(`/api/admin/marketing/content/${contentId}`, {
                action: modal.mode === "recycle" ? "recycle" : "schedule",
                scheduledFor,
              });
            }}
          />
        );
      })()}
      {message ? <p className="text-sm font-semibold text-brand-orange-deep">{message}</p> : null}

      {showNewWeek ? (
        <NewWeekModal
          key={newWeekSession}
          busy={busy}
          initialWeekStart={nextMondayDefault()}
          onClose={() => setShowNewWeek(false)}
          onCreated={(planId) => void load(planId)}
          setMessage={setMessage}
        />
      ) : null}

      {!content.length && rejectedContent.length === 0 ? (
        <Card className="border-brand-brown/15 bg-cream-deep/30">
          <p className="text-sm text-brand-charcoal/80">{EMPTY_WEEK_MESSAGE}</p>
          <p className="mt-3">
            <Link
              href="/admin/marketing/content"
              className="text-sm font-bold text-brand-navy underline"
            >
              Go to Content
            </Link>
            <span className="text-sm text-brand-charcoal/50"> to add posts to this week.</span>
          </p>
        </Card>
      ) : null}

      {rejectedContent.length > 0 ? (
        <Card className="border-brand-brown/20 bg-cream-deep/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-brand-charcoal/55">
                Rejected / history
              </p>
              <p className="mt-1 text-sm font-semibold text-brand-charcoal">
                {rejectedContent.length} rejected post{rejectedContent.length === 1 ? "" : "s"}
              </p>
            </div>
            <SecondaryButton
              disabled={busy}
              onClick={() => setShowRejectedHistory((open) => !open)}
            >
              {showRejectedHistory ? "Hide rejected" : "View rejected"}
            </SecondaryButton>
          </div>
          {showRejectedHistory ? (
            <ul className="mt-4 space-y-4 border-t border-brand-brown/15 pt-4">
              {rejectedContent.map((item) => {
                const review = rejectedReviewByContentId[item.id];
                const feedback = rejectionFeedbackByContentId[item.id];
                return (
                  <li
                    key={item.id}
                    className="rounded-2xl border border-brand-brown/15 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {review?.channelLabel ? (
                          <p className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
                            {review.channelLabel}
                          </p>
                        ) : null}
                        <WeeklyVisualPreview review={review} title={item.title} />
                        <div className="mt-2 flex flex-wrap gap-2">
                          <StatusPill status="rejected" />
                          <StatusPill status={item.platform} />
                        </div>
                        <h4 className="mt-2 text-lg font-extrabold">{item.title}</h4>
                        <p className="mt-2 line-clamp-4 text-sm text-brand-charcoal/80">{item.body}</p>
                        {feedback ? (
                          <p className="mt-2 text-sm text-brand-orange-deep">
                            <span className="font-bold">Reason:</span> {feedback}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-2">
                        <PrimaryButton disabled={busy} onClick={() => void restoreRejected(item.id)}>
                          Restore
                        </PrimaryButton>
                        <SecondaryButton
                          disabled={busy}
                          onClick={() => void permanentlyDeleteRejected(item)}
                        >
                          Delete permanently
                        </SecondaryButton>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {[...grouped.entries()].map(([platform, items]) => (
        <section key={platform} className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-brand-green-deep">{platform}</h3>
          {items.map((item) => {
            const review = reviewByContentId[item.id];
            const contentPublications = (settings?.publications ?? []).filter(
              (row) => row.contentId === item.id,
            );
            const hasPublishedPublication = contentPublications.some(
              (row) => row.status === "published",
            );
            return (
            <Card key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {review?.channelLabel ? (
                    <p className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
                      {review.channelLabel}
                    </p>
                  ) : null}
                  <WeeklyVisualPreview review={review} title={item.title} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusPill
                      status={
                        publicationByContent.get(item.id)
                          ? formatPublicationStatusLabel(publicationByContent.get(item.id)!)
                          : item.status
                      }
                    />
                    {publicationByContent.get(item.id) ? (
                      <span className="self-center text-xs text-brand-charcoal/55">
                        Provider: {publicationByContent.get(item.id)!.provider}
                      </span>
                    ) : null}
                    <StatusPill status={item.category} />
                    <StatusPill status={item.format} />
                    {item.needsNewAsset ? <StatusPill status="needs asset" /> : null}
                  </div>
                  <h4 className="mt-2 text-lg font-extrabold">{item.title}</h4>
                  <textarea
                    className="mt-3 w-full rounded-2xl border border-brand-brown/20 p-3 text-sm"
                    rows={6}
                    value={editing[item.id] ?? item.body}
                    onChange={(event) =>
                      setEditing((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                  />
                  {item.warnings.length ? (
                    <ul className="mt-2 list-disc pl-5 text-xs text-brand-orange-deep">
                      {item.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                  {item.trackingToken ? (
                    <p className="mt-2 text-xs text-brand-charcoal/55">
                      Tracking link: /api/m/{item.trackingToken}
                    </p>
                  ) : null}
                </div>
                <ContentReviewCardActions
                  item={item}
                  busy={busy}
                  hasPublishedPublication={hasPublishedPublication}
                  onApprove={() =>
                    void act(`/api/admin/marketing/content/${item.id}`, { action: "approve" })
                  }
                  onSaveEdit={() =>
                    void act(`/api/admin/marketing/content/${item.id}`, {
                      action: "edit",
                      body: editing[item.id] ?? item.body,
                    })
                  }
                  onRegenerate={() =>
                    void act(`/api/admin/marketing/content/${item.id}`, { action: "regenerate" })
                  }
                  onReject={() =>
                    void act(`/api/admin/marketing/content/${item.id}`, {
                      action: "reject",
                      feedback: "Rejected from weekly review.",
                    })
                  }
                  onSchedule={() => setScheduleItem(item)}
                  onRecycle={() => setRecycleItem(item)}
                />
              </div>
            </Card>
            );
          })}
        </section>
      ))}
    </div>
  );
}
