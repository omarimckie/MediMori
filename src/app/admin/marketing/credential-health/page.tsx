import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { CredentialHealthClient } from "@/components/admin/marketing/CredentialHealthClient";

export default function MarketingCredentialHealthPage() {
  return (
    <MarketingFrame
      title="Meta credential health"
      pathname="/admin/marketing/credential-health"
    >
      <CredentialHealthClient />
    </MarketingFrame>
  );
}
