import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { WeekClient } from "@/components/admin/marketing/WeekClient";

export default function WeekPage() {
  return (
    <MarketingFrame title="Your week" pathname="/admin/marketing/week">
      <WeekClient />
    </MarketingFrame>
  );
}
