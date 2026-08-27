import { searchActiveListings } from "@/lib/jobs/repository";
import { normalizeComparable } from "@/lib/jobs/normalize";
import type { CandidateProfile, CrawledJobListing, JobListingRecord } from "@/lib/jobs/types";

// Kullanıcı eşleşen aktif ilanların tamamını görmek istiyor; AI'ya giden
// aday havuzu geniş tutulur (süre worker akışında sorun değil).
const MAX_PREFILTER = Number(process.env.SEARCH_MAX_CANDIDATES ?? 60);
const MAX_AI_CANDIDATES = Number(process.env.SEARCH_MAX_CANDIDATES ?? 60);
const FRESH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type ScoredListing = {
  listing: JobListingRecord;
  cheapScore: number;
};

/**
 * Cache-first candidate selection. This NEVER triggers the live crawler.
 *  1. Pull a broad active-only candidate list from the DB cache.
 *  2. Score each with a cheap (non-AI) heuristic.
 *  3. Return the top candidates as CrawledJobListing items ready for AI scoring.
 */
export async function searchCachedListings(profile: CandidateProfile): Promise<CrawledJobListing[]> {
  const records = await searchActiveListings(profile);

  const scored: ScoredListing[] = records
    .map((listing) => ({ listing, cheapScore: cheapScore(listing, profile) }))
    .sort((left, right) => right.cheapScore - left.cheapScore)
    .slice(0, MAX_PREFILTER);

  return scored.slice(0, MAX_AI_CANDIDATES).map(({ listing, cheapScore: score }) => toCrawledListing(listing, score, profile));
}

/**
 * Cheap prefilter score. Pure string/relevance heuristics — no network, no AI.
 * Mirrors the scoring rules in the product spec.
 */
export function cheapScore(listing: JobListingRecord, profile: CandidateProfile): number {
  if (listing.status !== "active") {
    return -1;
  }

  let score = 0;
  const title = normalizeComparable(listing.title);
  const description = normalizeComparable(listing.description);
  const location = normalizeComparable(listing.location ?? "");

  // Target role in the title.
  const targetRole = normalizeComparable(profile.targetRole);
  if (targetRole && title.includes(targetRole)) {
    score += 30;
  }

  // Any alternative target position in the title.
  const otherTitles = profile.titles
    .filter((value) => normalizeComparable(value) !== targetRole)
    .map(normalizeComparable)
    .filter(Boolean);
  if (otherTitles.some((value) => title.includes(value))) {
    score += 20;
  }

  // Skills found in the description (+5 each, capped at 30).
  let skillScore = 0;
  for (const skill of profile.skills) {
    const normalized = normalizeComparable(skill);
    if (normalized.length >= 2 && description.includes(normalized)) {
      skillScore += 5;
      if (skillScore >= 30) break;
    }
  }
  score += Math.min(30, skillScore);

  // Search keywords found in the description (+2 each, capped at 20).
  let keywordScore = 0;
  const skillSet = new Set(profile.skills.map(normalizeComparable));
  for (const keyword of profile.keywords) {
    const normalized = normalizeComparable(keyword);
    if (normalized.length >= 3 && !skillSet.has(normalized) && description.includes(normalized)) {
      keywordScore += 2;
      if (keywordScore >= 20) break;
    }
  }
  score += Math.min(20, keywordScore);

  // Location preference.
  if (profile.locationMode === "cities" && profile.locations.length && location) {
    const hasCity = profile.locations.some((city) => location.includes(normalizeComparable(city)));
    if (hasCity) {
      score += 15;
    }
  }

  // Work-mode preference (exact match strong, near match partial).
  if (profile.workMode !== "any" && listing.workMode) {
    if (listing.workMode === profile.workMode) {
      score += 15;
    } else if (listing.workMode === "hybrid" || profile.workMode === "hybrid") {
      score += 8;
    }
  }

  // Freshness.
  if (isFresh(listing.lastSeenAt)) {
    score += 10;
  }

  // Has a real description.
  if (listing.description.trim().length > 0) {
    score += 5;
  }

  return score;
}

export function toCrawledListing(
  listing: JobListingRecord,
  cheapScoreValue: number,
  profile: CandidateProfile
): CrawledJobListing {
  return {
    platform: listing.platform,
    category: listing.category,
    externalId: listing.externalId,
    title: listing.title,
    company: listing.company,
    location: listing.location,
    workMode: listing.workMode,
    description: listing.description,
    requirements: listing.requirements,
    candidateCriteria: listing.candidateCriteria,
    url: listing.externalUrl,
    sourceQuery: listing.sourceQuery ?? profile.targetRole,
    postedAt: listing.postedAt,
    listingId: listing.id,
    cheapScore: cheapScoreValue
  };
}

function isFresh(lastSeenAt?: string): boolean {
  if (!lastSeenAt) {
    return false;
  }
  const seen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(seen)) {
    return false;
  }
  return Date.now() - seen <= FRESH_WINDOW_MS;
}
