import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { AssetsClient } from "@/components/admin/marketing/AssetsClient";

export default function AssetsPage() {
  return (
    <MarketingFrame title="Assets" pathname="/admin/marketing/assets">
      <AssetsClient />
    </MarketingFrame>
  );
}
