import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { IncidentsClient } from "@/components/admin/marketing/IncidentsClient";

export default function MarketingIncidentsPage() {
  return (
    <MarketingFrame
      title="Incidents"
      pathname="/admin/marketing/incidents"
      guideId="incidents"
    >
      <IncidentsClient />
    </MarketingFrame>
  );
}
