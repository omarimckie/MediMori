import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Marketing Autopilot",
  robots: { index: false, follow: false },
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return children;
}
