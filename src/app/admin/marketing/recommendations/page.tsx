import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { RecommendationsClient } from "@/components/admin/marketing/RecommendationsClient";

export default function RecommendationsPage() {
  return (
    <MarketingFrame title="Recommendations" pathname="/admin/marketing/recommendations">
      <RecommendationsClient />
    </MarketingFrame>
  );
}
