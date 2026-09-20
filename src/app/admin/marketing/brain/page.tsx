import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { BrainClient } from "@/components/admin/marketing/BrainClient";

export default function BrainPage() {
  return (
    <MarketingFrame title="Marketing brain" pathname="/admin/marketing/brain">
      <BrainClient />
    </MarketingFrame>
  );
}
