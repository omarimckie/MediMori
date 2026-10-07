import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { IncidentDetailClient } from "@/components/admin/marketing/IncidentDetailClient";

type PageProps = {
  params: Promise<{ incidentId: string }>;
};

export default async function MarketingIncidentDetailPage({ params }: PageProps) {
  const { incidentId } = await params;
  return (
    <MarketingFrame
      title="Incident"
      pathname="/admin/marketing/incidents"
      guideId="incidents"
    >
      <IncidentDetailClient incidentId={incidentId} />
    </MarketingFrame>
  );
}
