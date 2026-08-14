import resourcesData from "@/data/resources.json";

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
