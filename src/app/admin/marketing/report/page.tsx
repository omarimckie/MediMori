import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { ReportClient } from "@/components/admin/marketing/ReportClient";

export default function ReportPage() {
  return (
    <MarketingFrame title="Weekly report" pathname="/admin/marketing/report">
      <ReportClient />
    </MarketingFrame>
  );
}
