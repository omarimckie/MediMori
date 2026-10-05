import type { ReactNode } from "react";
import { MarketingPageGuide } from "@/components/admin/marketing/MarketingPageGuide";
import { MarketingShell } from "@/components/admin/marketing/MarketingShell";
import type { MarketingPageGuideId } from "@/lib/marketing/marketing-page-guides";

export function MarketingFrame({
  title,
  pathname,
  guideId,
  children,
}: {
  title: string;
  pathname: string;
  guideId?: MarketingPageGuideId;
  children: ReactNode;
}) {
  return (
    <MarketingShell title={title} pathname={pathname}>
      {guideId ? <MarketingPageGuide id={guideId} /> : null}
      {children}
    </MarketingShell>
  );
}
