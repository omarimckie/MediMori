import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { CostsClient } from "@/components/admin/marketing/CostsClient";

export default function CostsPage() {
  return (
    <MarketingFrame title="Operation costs" pathname="/admin/marketing/costs">
      <CostsClient />
    </MarketingFrame>
  );
}
