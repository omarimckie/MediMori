import { getMarketingStore } from "@/lib/marketing/context";
import { listPublishedFreeResources } from "@/lib/marketing/free-resources";
import { buildPublicSitemap } from "@/lib/public-sitemap";
import type { MetadataRoute } from "next";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildPublicSitemap(() => listPublishedFreeResources(getMarketingStore()));
}
