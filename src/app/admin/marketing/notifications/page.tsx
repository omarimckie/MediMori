import { MarketingFrame } from "@/components/admin/marketing/MarketingFrame";
import { NotificationsClient } from "@/components/admin/marketing/NotificationsClient";

export default function MarketingNotificationsPage() {
  return (
    <MarketingFrame title="Notifications" pathname="/admin/marketing/notifications">
      <NotificationsClient />
    </MarketingFrame>
  );
}
