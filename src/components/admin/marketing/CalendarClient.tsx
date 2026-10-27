"use client";

import type { CalendarAddExistingMode } from "@/lib/marketing/calendar-add-existing-eligibility";
import {
  buildCalendarMonthCells,
  currentMarketingMonth,
  monthYearLabel,
  shiftMarketingMonth,
} from "@/lib/marketing/calendar-month-grid";
import {
  calendarEventShowsRecycleBadge,
  calendarEventStatusLabel,
} from "@/lib/marketing/calendar-publication-eligibility";
import { filterUnscheduledApprovedContent } from "@/lib/marketing/calendar-unscheduled";
import type { MarketingCalendarEvent } from "@/lib/marketing/marketing-calendar";
import { calendarDayKeyForEvent } from "@/lib/marketing/marketing-calendar";
import { calendarDayKeyInMarketingTimezone } from "@/lib/marketing/marketing-scheduling";
import type { MarketingContent, MarketingPublication } from "@/lib/marketing/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AddExistingPostPickerModal,
  type AddExistingPostPickerItem,
} from "./AddExistingPostPickerModal";
import { CalendarPublicationDetailModal } from "./CalendarPublicationDetailModal";
import { ScheduleContentModal } from "./ScheduleContentModal";
import { Card, PrimaryButton, SecondaryButton, StatusPill } from "./ui";
import { runMarketingWeekPostAction } from "./week-client-act";

type ScheduleTarget = {
  id: string;
  title: string | null;
  platform: string;
  scheduledFor: string | null;
  mode: CalendarAddExistingMode | "schedule";
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarClient() {
  const [events, setEvents] = useState<MarketingCalendarEvent[]>([]);
  const [marketingTimezone, setMarketingTimezone] = useState("America/New_York");
  const [viewYear, setViewYear] = useState<number | null>(null);
  const [viewMonth, setViewMonth] = useState<number | null>(null);
  const [detailEvent, setDetailEvent] = useState<MarketingCalendarEvent | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerItems, setPickerItems] = useState<AddExistingPostPickerItem[]>([]);
  const [pickerPublications, setPickerPublications] = useState<
    Pick<MarketingPublication, "contentId" | "platform" | "status" | "publishedAt" | "externalId">[]
  >([]);
  const [unscheduled, setUnscheduled] = useState<MarketingContent[]>([]);
  const [weeklyPlans, setWeeklyPlans] = useState<Array<{ id: string; weekStart: string }>>([]);
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const ensureViewMonth = useCallback(() => {
    if (viewYear !== null && viewMonth !== null) return;
    const { year, month } = currentMarketingMonth(marketingTimezone);
    setViewYear(year);
    setViewMonth(month);
  }, [marketingTimezone, viewMonth, viewYear]);

  const loadCalendar = useCallback(async () => {
    const data = await fetch("/api/admin/marketing/calendar").then((res) => res.json());
    setEvents(data.events ?? []);
    const tz = data.marketingTimezone ?? "America/New_York";
    setMarketingTimezone(tz);
    if (viewYear === null || viewMonth === null) {
      const { year, month } = currentMarketingMonth(tz);
      setViewYear(year);
      setViewMonth(month);
    }
  }, [viewMonth, viewYear]);

  const loadUnscheduled = useCallback(async () => {
    const [contentRes, settingsRes] = await Promise.all([
      fetch("/api/admin/marketing/content?status=approved"),
      fetch("/api/admin/marketing/settings"),
    ]);
    const contentData = await contentRes.json();
    const settingsData = await settingsRes.json();
    const publications = (settingsData.publications ?? []) as Pick<
      MarketingPublication,
      "contentId" | "platform" | "status"
    >[];
    const approved = (contentData.content ?? []) as MarketingContent[];
    setUnscheduled(filterUnscheduledApprovedContent(approved, publications));
    setWeeklyPlans(
      ((settingsData.plans ?? []) as Array<{ id: string; weekStart: string }>).map((plan) => ({
        id: plan.id,
        weekStart: plan.weekStart,
      })),
    );
  }, []);

  const reloadAll = useCallback(async () => {
    await Promise.all([loadCalendar(), loadUnscheduled()]);
  }, [loadCalendar, loadUnscheduled]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  useEffect(() => {
    ensureViewMonth();
  }, [ensureViewMonth]);

  async function openPicker() {
    setMessage(null);
    setBusy(true);
    try {
      const [contentRes, settingsRes] = await Promise.all([
        fetch("/api/admin/marketing/content"),
        fetch("/api/admin/marketing/settings"),
      ]);
      const contentData = await contentRes.json();
      const settingsData = await settingsRes.json();
      setPickerItems(contentData.content ?? []);
      setPickerPublications(settingsData.publications ?? []);
      setShowPicker(true);
    } catch {
      setMessage("Could not load content for picker.");
    } finally {
      setBusy(false);
    }
  }

  async function submitSchedule(scheduledFor: string) {
    if (!scheduleTarget) return;
    const contentId = scheduleTarget.id;
    const action =
      scheduleTarget.mode === "recycle" ? "recycle" : "schedule";
    setBusy(true);
    setMessage(null);
    setScheduleTarget(null);
    setDetailEvent(null);
    try {
      const errorMessage = await runMarketingWeekPostAction(
        `/api/admin/marketing/content/${contentId}`,
        { action, scheduledFor },
        fetch,
        reloadAll,
      );
      if (errorMessage) setMessage(errorMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  const eventsByDay = useMemo(() => {
    const byDay = new Map<string, MarketingCalendarEvent[]>();
    for (const event of events) {
      const day = calendarDayKeyForEvent(event, marketingTimezone);
      const list = byDay.get(day) ?? [];
      list.push(event);
      byDay.set(day, list);
    }
    for (const [, list] of byDay) {
      list.sort((a, b) => a.placementAt.localeCompare(b.placementAt));
    }
    return byDay;
  }, [events, marketingTimezone]);

  const year = viewYear ?? currentMarketingMonth(marketingTimezone).year;
  const month = viewMonth ?? currentMarketingMonth(marketingTimezone).month;
  const cells = buildCalendarMonthCells(year, month, marketingTimezone);
  const todayKey = calendarDayKeyInMarketingTimezone(
    new Date().toISOString(),
    marketingTimezone,
  );

  function goToday() {
    const { year: y, month: m } = currentMarketingMonth(marketingTimezone);
    setViewYear(y);
    setViewMonth(m);
  }

  function shiftMonth(delta: number) {
    const next = shiftMarketingMonth(year, month, delta);
    setViewYear(next.year);
    setViewMonth(next.month);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-brand-charcoal/70">
          Marketing calendar · published and scheduled posts · {marketingTimezone}
        </p>
        <SecondaryButton type="button" disabled={busy} onClick={() => void openPicker()}>
          Add existing post
        </SecondaryButton>
      </div>

      {message ? <p className="text-sm font-semibold text-brand-orange-deep">{message}</p> : null}

      <Card className="p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl text-brand-navy">{monthYearLabel(year, month)}</h2>
          <div className="flex flex-wrap gap-2">
            <SecondaryButton type="button" disabled={busy} onClick={() => shiftMonth(-1)}>
              Previous
            </SecondaryButton>
            <SecondaryButton type="button" disabled={busy} onClick={goToday}>
              Today
            </SecondaryButton>
            <SecondaryButton type="button" disabled={busy} onClick={() => shiftMonth(1)}>
              Next
            </SecondaryButton>
          </div>
        </div>

        <div className="mt-4 hidden grid-cols-7 gap-1 text-center text-xs font-bold uppercase tracking-wide text-brand-charcoal/55 md:grid">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label}>{label}</div>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7 lg:gap-1">
          {cells.map((cell) => {
            const dayEvents = eventsByDay.get(cell.dayKey) ?? [];
            const isToday = cell.dayKey === todayKey;
            return (
              <div
                key={cell.dayKey}
                className={`min-h-[5.5rem] rounded-xl border p-2 lg:min-h-[7.5rem] ${
                  cell.inCurrentMonth
                    ? "border-brand-brown/15 bg-cream/40"
                    : "border-transparent bg-brand-charcoal/5"
                } ${isToday ? "ring-2 ring-brand-green-deep/40" : ""}`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`text-sm font-bold ${
                      cell.inCurrentMonth ? "text-brand-navy" : "text-brand-charcoal/40"
                    }`}
                  >
                    {cell.day}
                  </span>
                  <span className="text-[10px] text-brand-charcoal/45 lg:hidden">
                    {cell.dayKey}
                  </span>
                </div>
                <ul className="mt-1 space-y-1">
                  {dayEvents.map((event) => (
                    <li key={event.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setDetailEvent(event)}
                        className={`w-full rounded-lg border px-1.5 py-1 text-left text-xs transition hover:opacity-90 ${
                          event.eventKind === "published"
                            ? "border-brand-brown/25 bg-white text-brand-charcoal"
                            : "border-brand-sky/40 bg-brand-sky/15 text-brand-navy"
                        }`}
                      >
                        <span className="line-clamp-2 font-semibold leading-tight">
                          {event.title || event.platform}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-brand-charcoal/65">
                          <span>{event.platform}</span>
                          <span aria-hidden>·</span>
                          <span>{calendarEventStatusLabel(event)}</span>
                          {calendarEventShowsRecycleBadge(event) ? (
                            <span className="rounded border border-brand-navy/25 px-1">R</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-xl text-brand-navy">Unscheduled</h2>
        <p className="mt-1 text-sm text-brand-charcoal/65">
          Approved content ready to schedule. Not shown on the calendar until you pick a date.
        </p>
        {unscheduled.length ? (
          <ul className="mt-4 space-y-2">
            {unscheduled.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-brown/10 pb-2 last:border-0"
              >
                <div>
                  <p className="font-bold">{item.title || item.platform}</p>
                  <p className="text-xs text-brand-charcoal/60">{item.platform}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill status="approved" />
                  <PrimaryButton
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setScheduleTarget({
                        id: item.id,
                        title: item.title,
                        platform: item.platform,
                        scheduledFor: item.scheduledFor,
                        mode: "schedule",
                      })
                    }
                  >
                    Schedule
                  </PrimaryButton>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-brand-charcoal/70">No unscheduled approved content.</p>
        )}
      </Card>

      {detailEvent ? (
        <CalendarPublicationDetailModal
          event={detailEvent}
          marketingTimezone={marketingTimezone}
          busy={busy}
          onClose={() => setDetailEvent(null)}
          onRecycle={() => {
            setScheduleTarget({
              id: detailEvent.contentId,
              title: detailEvent.title,
              platform: detailEvent.platform,
              scheduledFor: detailEvent.scheduledFor,
              mode: "recycle",
            });
          }}
        />
      ) : null}

      {showPicker ? (
        <AddExistingPostPickerModal
          items={pickerItems}
          publications={pickerPublications}
          busy={busy}
          onClose={() => setShowPicker(false)}
          onSelect={(item, mode) => {
            setShowPicker(false);
            setScheduleTarget({
              id: item.id,
              title: item.title,
              platform: item.platform,
              scheduledFor: item.scheduledFor,
              mode,
            });
          }}
        />
      ) : null}

      {scheduleTarget ? (
        <ScheduleContentModal
          mode={scheduleTarget.mode === "recycle" ? "recycle" : "schedule"}
          title={scheduleTarget.title}
          platform={scheduleTarget.platform}
          marketingTimezone={marketingTimezone}
          initialScheduledFor={scheduleTarget.scheduledFor}
          assignedWeekStart={
            weeklyPlans.find(
              (plan) =>
                plan.id ===
                unscheduled.find((row) => row.id === scheduleTarget.id)?.weeklyPlanId,
            )?.weekStart ?? null
          }
          busy={busy}
          onClose={() => setScheduleTarget(null)}
          onConfirm={(scheduledFor) => {
            void submitSchedule(scheduledFor);
          }}
        />
      ) : null}
    </div>
  );
}
