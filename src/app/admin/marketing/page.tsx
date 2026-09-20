import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { OverviewClient } from "@/components/admin/marketing/OverviewClient";

export default function MarketingOverviewPage() {
  return (
    <MarketingFrame title="Overview" pathname="/admin/marketing">
      <OverviewClient />
    </MarketingFrame>
  );
}
