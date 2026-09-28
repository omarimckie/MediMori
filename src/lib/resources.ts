import resourcesData from "@/data/resources.json";
import { listPublishedFreeResources } from "@/lib/marketing/free-resources";
import { getMarketingStore } from "@/lib/marketing/context";

export type RecommendedResource = {
  id: string;
  category: string;
  title: string;
  description: string;
  source: string;
  cta: string;
  url: string;
};

export function getRecommendedResources(): RecommendedResource[] {
  return resourcesData.resources as RecommendedResource[];
}

export async function getCombinedResources(): Promise<RecommendedResource[]> {
  const curated = getRecommendedResources();
  let published: RecommendedResource[] = [];
  try {
    const rows = await listPublishedFreeResources(getMarketingStore());
    published = rows.map((row) => ({
      id: row.id,
      category: row.resourceTypeLabel,
      title: row.title,
      description: row.description,
      source: "Twilight Feather",
      cta: "View & download",
      url: row.publicPath,
    }));
  } catch {
    published = [];
  }
  return [...published, ...curated];
}
