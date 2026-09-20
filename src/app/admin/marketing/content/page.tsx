import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { ContentClient } from "@/components/admin/marketing/ContentClient";

export default function ContentPage() {
  return (
    <MarketingFrame title="Content" pathname="/admin/marketing/content">
      <ContentClient />
    </MarketingFrame>
  );
}
