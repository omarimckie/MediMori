"use client";

import type { CalendarAddExistingMode } from "@/lib/marketing/calendar-add-existing-eligibility";
import {
  calendarDayKeyInMarketingTimezone,
  formatMarketingScheduleDisplay,
} from "@/lib/marketing/marketing-scheduling";
import type { MarketingPublication } from "@/lib/marketing/types";
import { useCallback, useEffect, useState } from "react";
import {
  AddExistingPostPickerModal,
  type AddExistingPostPickerItem,
} from "./AddExistingPostPickerModal";
import { ScheduleContentModal } from "./ScheduleContentModal";
import { PrimaryButton, Card, StatusPill } from "./ui";
import { runMarketingWeekPostAction } from "./week-client-act";

type CalendarEvent = {
  id: string;
  contentId: string;
  publicationId: string;
  platform: string;
  title: string | null;
  status: string;
  scheduledFor: string;
  timezone: string;
};

type ScheduleTarget = AddExistingPostPickerItem & { mode: CalendarAddExistingMode };

export function CalendarClient() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [marketingTimezone, setMarketingTimezone] = useState("America/New_York");
  const [showPicker, setShowPicker] = useState(false);
  const [pickerItems, setPickerItems] = useState<AddExistingPostPickerItem[]>([]);
  const [pickerPublications, setPickerPublications] = useState<
    Pick<MarketingPublication, "contentId" | "platform" | "status" | "publishedAt" | "externalId">[]
  >([]);
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadCalendar = useCallback(async () => {
    const data = await fetch("/api/admin/marketing/calendar").then((res) => res.json());
    setEvents(data.events ?? []);
    setMarketingTimezone(data.marketingTimezone ?? "America/New_York");
  }, []);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

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
    const action = scheduleTarget.mode === "recycle" ? "recycle" : "schedule";
    setBusy(true);
    setMessage(null);
    setScheduleTarget(null);
    try {
      const errorMessage = await runMarketingWeekPostAction(
        `/api/admin/marketing/content/${contentId}`,
        { action, scheduledFor },
        fetch,
        loadCalendar,
      );
      if (errorMessage) setMessage(errorMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const day = calendarDayKeyInMarketingTimezone(
      event.scheduledFor,
      event.timezone || marketingTimezone,
    );
    const list = byDay.get(day) ?? [];
    list.push(event);
    byDay.set(day, list);
  }

  const sortedDays = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-brand-charcoal/70">
          Publishing calendar · scheduled publications · times shown in {marketingTimezone}
        </p>
        <PrimaryButton type="button" disabled={busy} onClick={() => void openPicker()}>
          + Add existing post
        </PrimaryButton>
      </div>
      {message ? <p className="text-sm font-semibold text-brand-orange-deep">{message}</p> : null}
      {sortedDays.map(([day, dayItems]) => (
        <Card key={day}>
          <h2 className="font-display text-2xl text-brand-navy">{day}</h2>
          <ul className="mt-3 space-y-2">
            {dayItems
              .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
              .map((event) => (
                <li key={event.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold">{event.title || event.platform}</p>
                    <p className="text-xs text-brand-charcoal/60">
                      {event.platform} ·{" "}
                      {formatMarketingScheduleDisplay(
                        event.scheduledFor,
                        event.timezone || marketingTimezone,
                      )}
                    </p>
                  </div>
                  <StatusPill status={event.status} />
                </li>
              ))}
          </ul>
        </Card>
      ))}
      {!events.length ? (
        <p>
          No scheduled publications yet. Approve and schedule from Your week, recycle published
          content, or add an existing post above.
        </p>
      ) : null}
      {showPicker ? (
        <AddExistingPostPickerModal
          items={pickerItems}
          publications={pickerPublications}
          busy={busy}
          onClose={() => setShowPicker(false)}
          onSelect={(item, mode) => {
            setShowPicker(false);
            setScheduleTarget({ ...item, mode });
          }}
        />
      ) : null}
      {scheduleTarget ? (
        <ScheduleContentModal
          mode={scheduleTarget.mode}
          title={scheduleTarget.title}
          platform={scheduleTarget.platform}
          marketingTimezone={marketingTimezone}
          initialScheduledFor={scheduleTarget.scheduledFor}
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
