import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { CalendarClient } from "@/components/admin/marketing/CalendarClient";

export default function CalendarPage() {
  return (
    <MarketingFrame title="Calendar" pathname="/admin/marketing/calendar">
      <CalendarClient />
    </MarketingFrame>
  );
}
