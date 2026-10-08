import { searchActiveListings } from "@/lib/jobs/repository";
import { listSources } from "@/lib/jobs/source-registry";
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
/**
 * Yurt dışı kaynakların adları (registry country != TR).
 *
 * 60 saniyelik bellek içi önbellek: aday seçimi her aramada çağrılır,
 * registry sorgusunu her seferinde tekrarlamaya gerek yok.
 */
let foreignNamesCache: { at: number; names: Set<string> } | null = null;

async function getForeignSourceNames(): Promise<Set<string>> {
  if (foreignNamesCache && Date.now() - foreignNamesCache.at < 60_000) {
    return foreignNamesCache.names;
  }

  try {
    const sources = await listSources();
    const names = new Set(sources.filter((source) => source.country !== "TR").map((source) => source.name));
    foreignNamesCache = { at: Date.now(), names };
    return names;
  } catch {
    return foreignNamesCache?.names ?? new Set();
  }
}

export async function searchCachedListings(profile: CandidateProfile): Promise<CrawledJobListing[]> {
  const records = await searchActiveListings(profile);

  // Lokasyon GERÇEK bir filtre. Eskiden yalnızca cheapScore'a +15 ekliyordu;
  // AI skorları bu farkı kolayca bastırdığı için "Ankara" seçen kullanıcıya
  // İstanbul ilanları gelmeye devam ediyordu.
  const locationFiltered = filterByLocation(records, profile);

  const scored: ScoredListing[] = locationFiltered
    .map((listing) => ({ listing, cheapScore: cheapScore(listing, profile) }))
    .sort((left, right) => right.cheapScore - left.cheapScore);

  // ÜLKE KOTASI: Türkiye'deki bir aday için aday havuzunu yurt dışı kaynaklar
  // dolduramaz. Kök neden ölçüldü: İngilizce sorgu İngilizce metinli yabancı
  // ilanlarda daha güçlü eşleşiyor ve 60 slotun tamamını kapıyordu (arama
  // #64: 10/10 yabancı). Uzaktan çalışma tercihinde pay genişler; aksi hâlde
  // yabancı kaynaklara en fazla %20 yer var. TR adayları azsa yabancılar
  // kalanı doldurabilir — kota tavan, garanti değil.
  const foreignNames = await getForeignSourceNames();
  const foreignShare = profile.workMode === "remote" ? 0.4 : 0.2;
  const maxForeign = Math.max(2, Math.round(MAX_PREFILTER * foreignShare));

  const domestic: ScoredListing[] = [];
  const foreign: ScoredListing[] = [];

  for (const item of scored) {
    (foreignNames.has(item.listing.platform) ? foreign : domestic).push(item);
  }

  // Yabancılara en fazla `maxForeign` koltuk ayrılır; kalan koltuklar TR'nindir.
  // TR adayları koltuklarını dolduramazsa boş kalan yerleri yabancılar alır —
  // kota bir tavandır, sonuç sayısını asla düşürmez.
  const reservedForeign = Math.min(foreign.length, maxForeign);
  const takeDomestic = domestic.slice(0, MAX_PREFILTER - reservedForeign);
  const takeForeign = foreign.slice(0, MAX_PREFILTER - takeDomestic.length);

  const balanced = [...takeDomestic, ...takeForeign]
    .sort((left, right) => right.cheapScore - left.cheapScore)
    .slice(0, MAX_PREFILTER);

  if (foreign.length > takeForeign.length) {
    console.log(
      `[search-cache] Ülke kotası: aday havuzu TR=${takeDomestic.length}, yabancı=${takeForeign.length} (kesilen yabancı ${foreign.length - takeForeign.length}).`
    );
  }

  return balanced.slice(0, MAX_AI_CANDIDATES).map(({ listing, cheapScore: score }) => toCrawledListing(listing, score, profile));
}

/**
 * Seçilen illere göre eler.
 *
 * Lokasyonu BİLİNMEYEN ilanlar elenmez: ilan metninde şehir yazmaması onun
 * yanlış şehirde olduğunu kanıtlamaz, elemek gerçek fırsatları kaybettirir.
 * Yalnızca açıkça BAŞKA bir şehir yazan ilanlar düşer.
 *
 * Uzaktan çalışma seçiliyse lokasyon kısıtı uygulanmaz — remote ilanın şehri
 * önemsizdir.
 */
export function filterByLocation(records: JobListingRecord[], profile: CandidateProfile): JobListingRecord[] {
  if (profile.locationMode !== "cities" || !profile.locations.length || profile.workMode === "remote") {
    return records;
  }

  const wanted = profile.locations.map(normalizeComparable).filter(Boolean);

  if (!wanted.length) {
    return records;
  }

  const kept = records.filter((listing) => {
    const location = normalizeComparable(listing.location ?? "");

    // Lokasyon bilinmiyor → şüpheden yararlansın.
    if (!location) {
      return true;
    }

    // "istanbul(avrupa)", "kocaeli, gebze" gibi biçimler alt dize eşleşir.
    if (wanted.some((city) => location.includes(city))) {
      return true;
    }

    // Uzaktan çalışılabilen ilan, şehri farklı olsa da elenmez.
    return listing.workMode === "remote";
  });

  console.log(
    `[search-cache] Lokasyon filtresi (${profile.locations.join(", ")}): ${records.length} → ${kept.length} ilan`
  );

  return kept;
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
