import { HomeClient } from "@/components/HomeClient";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: DEFAULT_TITLE },
  description: DEFAULT_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: "/",
  },
  twitter: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
};

export default function Home() {
  return <HomeClient />;
}
