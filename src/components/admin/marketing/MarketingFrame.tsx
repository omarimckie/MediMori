import type { ReactNode } from "react";
import { MarketingShell } from "@/components/admin/marketing/MarketingShell";

export function MarketingFrame({
  title,
  pathname,
  children,
}: {
  title: string;
  pathname: string;
  children: ReactNode;
}) {
  return (
    <MarketingShell title={title} pathname={pathname}>
      {children}
    </MarketingShell>
  );
}
