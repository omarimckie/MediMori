import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { AnalyticsClient } from "@/components/admin/marketing/AnalyticsClient";

export default function AnalyticsPage() {
  return (
    <MarketingFrame title="Analytics" pathname="/admin/marketing/analytics">
      <AnalyticsClient />
    </MarketingFrame>
  );
}
