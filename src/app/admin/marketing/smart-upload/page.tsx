import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { SmartUploadClient } from "@/components/admin/marketing/SmartUploadClient";

export default function SmartUploadPage() {
  return (
    <MarketingFrame title="Smart Upload" pathname="/admin/marketing/smart-upload">
      <SmartUploadClient />
    </MarketingFrame>
  );
}
