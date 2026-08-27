import type { LocationMode, WorkMode } from "@/lib/search-preferences";

/**
 * Known platforms get autocomplete, but DB-sourced names (e.g. crawler or
 * sample data) may introduce others, so any string is also accepted.
 */
export type JobPlatform =
  | "Kariyer.net"
  | "Secretcv"
  | "Eleman.net"
  | "Yenibiriş"
  | "Toptalent"
  | "Webrazzi Jobs"
  | "LinkedIn"
  | "İŞKUR"
  | (string & {});

export type JobResultCategory = "recommended" | "general" | "tech" | "public";
export type JobResultKind = "search" | "job";
export type JobResultConfidence = "high" | "medium" | "low";

/** Lifecycle status of a cached listing in job_listings. */
export type JobListingStatus = "active" | "stale" | "expired" | "failed";

/** A row from job_listings joined with its source, as used by the cache search. */
export type JobListingRecord = {
  id: number;
  sourceId: number;
  platform: JobPlatform;
  category: JobResultCategory;
  externalId?: string;
  title: string;
  company?: string;
  location?: string;
  workMode?: WorkMode;
  description: string;
  requirements: string[];
  candidateCriteria: string[];
  externalUrl: string;
  sourceQuery?: string;
  postedAt?: string;
  status: JobListingStatus;
  lastSeenAt?: string;
  lastCheckedAt?: string;
};

/** Single requirement criterion for a job listing */
export type CriteriaItem = {
  name: string;
  status: "met" | "partial" | "unmet";
  detail: string;
};

/** Detailed criteria match breakdown for a job listing */
export type CriteriaMatchResult = {
  overallPercent: number;
  criteria: CriteriaItem[];
};

export type SearchJobsInput = {
  skills?: string[];
  titles?: string[];
  languages?: string[];
  experienceAreas?: string[];
  searchKeywords?: string[];
  industries?: string[];
  location?: string;
  locationMode?: LocationMode;
  cities?: string[];
  workMode?: WorkMode;
  userEmail?: string;
  /** Full CV text for AI-powered matching */
  fullText?: string;
  /** AI-extracted rich profile from CV evaluation */
  aiProfile?: AiCvProfile;
};

/** Rich profile extracted by AI from the full CV text */
export type AiCvProfile = {
  seniority?: string;
  yearsOfExperience?: number;
  lastRole?: string;
  lastCompany?: string;
  targetPositions?: string[];
  certifications?: string[];
  education?: string;
  educationLevel?: string;
  achievements?: string[];
  projectDetails?: string[];
  preferredRoles?: string[];
  unwantedRoles?: string[];
  companySummary?: string;
  /** AI-generated synonyms and alternative queries in TR/EN */
  queryVariations?: string[];
  /** Short CV summary for batch scoring */
  cvSummary?: string;
  /** Profession category detected by AI */
  professionCategory?: string;
};

export type JobSearchResult = {
  id: string;
  kind: JobResultKind;
  platform: JobPlatform;
  category: JobResultCategory;
  title: string;
  company?: string;
  location?: string;
  workMode?: string;
  query: string;
  description: string;
  url: string;
  matchScore: number;
  matchReasons: string[];
  confidence: JobResultConfidence;
  actionLabel: string;
  postedAt?: string;
  matchedKeywords?: string[];
  /** Detailed criteria match breakdown (AI-powered) */
  criteriaMatch?: CriteriaMatchResult;
  /** job_listings.id — başvuru kaydını gerçek ilana bağlar. */
  listingId?: number;
  /** İlanın "aranan nitelikler" satırları; CV uyarlaması bunları kullanır. */
  requirements?: string[];
  /** İlanın "aday kriterleri" satırları. */
  candidateCriteria?: string[];
};

export type PlatformCrawlStatus = {
  platform: JobPlatform;
  status: "success" | "partial" | "empty" | "failed" | "timeout";
  searchedUrls: number;
  discoveredUrls: number;
  parsedListings: number;
  message?: string;
};

export type JobSearchSummary = {
  targetRole: string;
  primarySkills: string[];
  locations: string[];
  workMode: string;
  resultCount: number;
  realJobCount?: number;
  fallbackCount?: number;
  sourceNote: string;
  crawlStatuses?: PlatformCrawlStatus[];
  /** Structured error info for frontend */
  errorType?: "no_match" | "crawler_failed" | "parser_error" | "query_issue" | "none";
};

export type JobSearchResponse = {
  results: JobSearchResult[];
  summary: JobSearchSummary;
  fallbackResults?: JobSearchResult[];
};

export type CandidateProfile = {
  targetRole: string;
  titles: string[];
  skills: string[];
  languages: string[];
  industries: string[];
  experienceAreas: string[];
  keywords: string[];
  locations: string[];
  locationMode: LocationMode;
  workMode: WorkMode;
  /** Full CV text for AI scoring */
  fullText?: string;
  /** AI-generated short summary for batch scoring */
  cvSummary?: string;
  /** AI-generated query variations (TR/EN synonyms) */
  queryVariations?: string[];
  /** Seniority level */
  seniority?: string;
  /** Years of experience */
  yearsOfExperience?: number;
  /** Target positions the candidate is looking for */
  targetPositions?: string[];
  /** Certifications */
  certifications?: string[];
  /** Education level */
  educationLevel?: string;
  /** Preferred roles */
  preferredRoles?: string[];
  /** Profession category */
  professionCategory?: string;
};

export type CrawledJobListing = {
  platform: JobPlatform;
  category: JobResultCategory;
  externalId?: string;
  title: string;
  company?: string;
  location?: string;
  workMode?: WorkMode;
  description: string;
  requirements?: string[];
  candidateCriteria?: string[];
  url: string;
  sourceQuery: string;
  postedAt?: string;
  /** Set when the listing came from the DB cache. */
  listingId?: number;
  /** Cheap (non-AI) prefilter score, used to normalize fallback results. */
  cheapScore?: number;
};

export type JobAdapter = {
  platform: JobPlatform;
  category: JobResultCategory;
  buildSearchUrls: (query: string, profile: CandidateProfile) => string[];
  isDetailUrl: (url: URL) => boolean;
  /** Platform-specific detail page selectors */
  selectors?: PlatformSelectors;
};

export type PlatformSelectors = {
  title?: string[];
  company?: string[];
  location?: string[];
  description?: string[];
  requirements?: string[];
  date?: string[];
};

export type CrawlJobsResult = {
  listings: CrawledJobListing[];
  statuses: PlatformCrawlStatus[];
};
