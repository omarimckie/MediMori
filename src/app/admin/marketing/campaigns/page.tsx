import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { CampaignsClient } from "@/components/admin/marketing/CampaignsClient";

export default function CampaignsPage() {
  return (
    <MarketingFrame title="Campaigns" pathname="/admin/marketing/campaigns">
      <CampaignsClient />
    </MarketingFrame>
  );
}
