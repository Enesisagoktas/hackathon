import { generateJobSearchResults, type JobPlatform, type SearchJobsInput } from "@/lib/job-search";
import type { LocationMode, WorkMode } from "@/lib/search-preferences";

export type JobLinkCategory = "general-platforms" | "public-platforms" | "tech-platforms";

export type JobLink = {
  platform: JobPlatform;
  category: JobLinkCategory;
  title: string;
  query: string;
  description: string;
  url: string;
};

export type GenerateJobLinksInput = SearchJobsInput & {
  locationMode?: LocationMode;
  workMode?: WorkMode;
};

export function generateJobLinks(input: GenerateJobLinksInput) {
  return generateJobSearchResults(input).results.map((result): JobLink => ({
    platform: result.platform,
    category: toLegacyCategory(result.category),
    title: `${result.platform} · ${result.query}`,
    query: result.query,
    description: result.description,
    url: result.url
  }));
}

function toLegacyCategory(category: string): JobLinkCategory {
  if (category === "public") {
    return "public-platforms";
  }

  if (category === "tech") {
    return "tech-platforms";
  }

  return "general-platforms";
}
