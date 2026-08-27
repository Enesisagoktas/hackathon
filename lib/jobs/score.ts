import { getWorkModeDisplay } from "@/lib/search-preferences";
import type { CandidateProfile, CrawledJobListing, CriteriaItem, CriteriaMatchResult, JobSearchResult } from "@/lib/jobs/types";
import { truncateText } from "@/lib/jobs/normalize";
import { generateJsonWithGemini } from "@/lib/gemini";

const BATCH_SIZE = 4;
// Scoring is bounded and runs in parallel so a slow/unavailable Gemini never
// blocks the worker. A single attempt keeps the worst case ~SCORING_TIMEOUT_MS.
const SCORING_TIMEOUT_MS = Number(process.env.AI_SCORING_TIMEOUT_MS ?? 28000);
const SCORING_MAX_ATTEMPTS = Number(process.env.AI_SCORING_MAX_ATTEMPTS ?? 1);
const MIN_RESULTS = 6;

type AiScoreItem = {
  index: number;
  score: number;
  reasons: string[];
  missingSkills: string[];
  seniorityFit: string;
  matchedKeywords: string[];
  criteriaMatch: {
    overallPercent: number;
    criteria: { name: string; status: "met" | "partial" | "unmet"; detail: string }[];
  };
};

/**
 * AI-powered semantic scoring using Gemini.
 * No keyword fallback. If AI fails, the jobs are not scored.
 */
export async function scoreListingsWithAi(
  listings: CrawledJobListing[],
  profile: CandidateProfile
): Promise<JobSearchResult[]> {
  if (!profile.cvSummary && !profile.fullText) {
    console.warn("No CV text available for AI scoring; returning cheap-scored results.");
    return buildUnscoredResults(listings.slice(0, 15));
  }

  const topCandidates = listings.slice(0, 15);
  const batches = createBatches(topCandidates, BATCH_SIZE);

  // Run every batch concurrently. A failed or slow batch never blocks the
  // others, and its listings fall back to cheap-scored real results.
  const settled = await Promise.allSettled(batches.map((batch) => scoreBatchWithAi(batch, profile)));

  const scored: JobSearchResult[] = [];
  const leftover: CrawledJobListing[] = [];

  batches.forEach((batch, batchIndex) => {
    const outcome = settled[batchIndex];
    if (outcome.status !== "fulfilled") {
      console.error("AI batch scoring failed:", outcome.reason);
      leftover.push(...batch);
      return;
    }

    const aiScores = outcome.value;
    batch.forEach((listing, j) => {
      const aiScore = aiScores.find((s) => s.index === j);
      if (aiScore && aiScore.score >= 20) {
        scored.push(buildScoredResult(listing, aiScore, `${batchIndex}-${j}`));
      } else {
        leftover.push(listing);
      }
    });
  });

  // Never return an empty screen: if AI produced nothing usable, show the
  // cheap-ranked real listings. If results are sparse, top them up.
  if (scored.length === 0) {
    return buildUnscoredResults(topCandidates);
  }

  if (scored.length < MIN_RESULTS && leftover.length) {
    scored.push(...buildUnscoredResults(leftover).slice(0, MIN_RESULTS - scored.length));
  }

  return scored
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, 30)
    .map((result, index) => ({ ...result, id: `${result.id}:${index + 1}` }));
}

function buildScoredResult(listing: CrawledJobListing, aiScore: AiScoreItem, idSuffix: string): JobSearchResult {
  return {
    id: `${listing.platform}:${listing.externalId ?? listing.url}:${idSuffix}`,
    kind: "job",
    platform: listing.platform,
    category: aiScore.score >= 70 ? "recommended" : listing.category,
    title: listing.title,
    company: listing.company,
    location: listing.location,
    workMode: listing.workMode ? getWorkModeDisplay(listing.workMode) : undefined,
    query: listing.sourceQuery,
    description: truncateText(listing.description || listing.requirements?.join(" ") || "İlan açıklaması parse edildi."),
    url: listing.url,
    matchScore: aiScore.score,
    matchReasons: aiScore.reasons.slice(0, 5),
    confidence: aiScore.score >= 75 ? "high" : aiScore.score >= 50 ? "medium" : "low",
    actionLabel: "İlanı Aç",
    postedAt: listing.postedAt,
    matchedKeywords: aiScore.matchedKeywords.slice(0, 10),
    criteriaMatch: sanitizeCriteriaMatch(aiScore.criteriaMatch),
    // Başvuru katmanı bu üçünü kullanır: ilanı DB kaydına bağlamak ve
    // CV'yi ilanın gerçek nitelik metnine göre uyarlamak için.
    listingId: listing.listingId,
    requirements: listing.requirements,
    candidateCriteria: listing.candidateCriteria
  };
}

async function scoreBatchWithAi(
  listings: CrawledJobListing[],
  profile: CandidateProfile
): Promise<AiScoreItem[]> {
  const listingSummaries = listings.map((listing, index) => ({
    index,
    title: listing.title,
    company: listing.company ?? "Belirtilmemiş",
    location: listing.location ?? "Belirtilmemiş",
    workMode: listing.workMode ?? "Belirtilmemiş",
    description: listing.description.slice(0, 800),
    requirements: listing.requirements?.slice(0, 5).join("; ") ?? ""
  }));

  const cvContext = buildCvContext(profile);

  // Lean schema: only fields the UI actually uses, with a compact criteria set,
  // so gemini-2.5-flash can return JSON within the scoring timeout. Heavier
  // output (8 criteria, missingSkills, long details) caused frequent timeouts.
  const systemInstruction = `Sen uzman bir İK eşleştirme motorusun. Aday profili ile iş ilanlarını karşılaştırıp uyum skoru ve kısa kriter analizi üret. SADECE geçerli JSON döndür, kısa ve öz ol.

JSON şeması:
{
  "scores": [
    {
      "index": number,
      "score": number,
      "reasons": string[],
      "matchedKeywords": string[],
      "criteriaMatch": {
        "overallPercent": number,
        "criteria": [ { "name": string, "status": "met" | "partial" | "unmet", "detail": string } ]
      }
    }
  ]
}

Kurallar:
- reasons: en fazla 3 kısa madde (Türkçe).
- matchedKeywords: ilanla eşleşen en fazla 6 beceri/kelime.
- criteriaMatch.criteria: SADECE şu 5 kategoriyi değerlendir: "Teknik Beceriler", "Deneyim & Kıdem", "Eğitim", "Dil Yetkinliği", "Lokasyon".
- İlanda kriter belirtilmemişse status "met", detail "İlanda belirtilmemiş".
- detail: en fazla 1 kısa cümle (Türkçe).
- overallPercent: 0-100 arası genel uyum.

Puanlama: 85-100 çok güçlü, 70-84 iyi, 50-69 orta, 30-49 düşük, 0-29 uyumsuz. Kıdem uyumsuzluğu puanı düşürür.`;

  const prompt = `ADAY PROFİLİ:
${cvContext}

İŞ İLANLARI (${listingSummaries.length} adet):
${JSON.stringify(listingSummaries)}

Her ilan için skoru ve kısa kriter analizini üret.`;

  const parsed = await generateJsonWithGemini<{ scores: Record<string, unknown>[] }>(systemInstruction, prompt, {
    timeoutMs: SCORING_TIMEOUT_MS,
    maxAttempts: SCORING_MAX_ATTEMPTS
  });

  return (parsed.scores ?? []).map((item, fallbackIndex) => ({
    index: parseIndex(item.index, fallbackIndex),
    score: clampScore(item.score),
    reasons: toStringArray(item.reasons).slice(0, 5),
    missingSkills: toStringArray(item.missingSkills).slice(0, 6),
    seniorityFit: typeof item.seniorityFit === "string" ? item.seniorityFit : "belirsiz",
    matchedKeywords: toStringArray(item.matchedKeywords).slice(0, 10),
    criteriaMatch: parseCriteriaMatch(item.criteriaMatch)
  }));
}

/**
 * Fallback results when AI scoring is unavailable (e.g. Gemini 403/timeout).
 * Uses the cheap prefilter score so the user still sees ranked, REAL listings
 * instead of an empty screen.
 */
function buildUnscoredResults(listings: CrawledJobListing[]): JobSearchResult[] {
  return listings.slice(0, 10).map((listing, index) => {
    const matchScore = normalizeCheapScore(listing.cheapScore);
    return {
      id: `${listing.platform}:${listing.externalId ?? listing.url}:unscored:${index + 1}`,
      kind: "job",
      platform: listing.platform,
      category: listing.category,
      title: listing.title,
      company: listing.company,
      location: listing.location,
      workMode: listing.workMode ? getWorkModeDisplay(listing.workMode) : undefined,
      query: listing.sourceQuery,
      description: truncateText(listing.description || listing.requirements?.join(" ") || "İlan açıklaması parse edildi."),
      url: listing.url,
      matchScore,
      matchReasons: ["Gerçek ilan detay linki bulundu; AI skoru alınamadı, ön eşleşme puanı kullanıldı."],
      confidence: "low",
      actionLabel: "İlanı Aç",
      postedAt: listing.postedAt,
      matchedKeywords: [],
      listingId: listing.listingId,
      requirements: listing.requirements,
      candidateCriteria: listing.candidateCriteria
    };
  });
}

function normalizeCheapScore(cheapScore: number | undefined): number {
  if (typeof cheapScore !== "number" || !Number.isFinite(cheapScore) || cheapScore <= 0) {
    return 20;
  }
  return Math.min(55, Math.max(20, Math.round(cheapScore * 0.6)));
}

function buildCvContext(profile: CandidateProfile): string {
  const parts: string[] = [];

  if (profile.cvSummary) parts.push(`Özet: ${profile.cvSummary}`);
  parts.push(`Hedef Rol: ${profile.targetRole}`);
  if (profile.seniority) parts.push(`Kıdem: ${profile.seniority}`);
  if (profile.yearsOfExperience != null) parts.push(`Deneyim: ${profile.yearsOfExperience} yıl`);
  if (profile.skills.length) parts.push(`Beceriler: ${profile.skills.join(", ")}`);
  if (profile.titles.length) parts.push(`Uygun Pozisyonlar: ${profile.titles.join(", ")}`);
  if (profile.languages.length) parts.push(`Diller: ${profile.languages.join(", ")}`);
  if (profile.industries.length) parts.push(`Sektörler: ${profile.industries.join(", ")}`);
  if (profile.certifications?.length) parts.push(`Sertifikalar: ${profile.certifications.join(", ")}`);
  if (profile.educationLevel) parts.push(`Eğitim: ${profile.educationLevel}`);
  if (profile.professionCategory) parts.push(`Meslek Kategorisi: ${profile.professionCategory}`);
  if (profile.preferredRoles?.length) parts.push(`Tercih Edilen Roller: ${profile.preferredRoles.join(", ")}`);

  if (profile.fullText) {
    parts.push(`\nCV Tam Metin (kısaltılmış):\n${profile.fullText.slice(0, 2000)}`);
  }

  return parts.join("\n");
}

function parseCriteriaMatch(value: unknown): AiScoreItem["criteriaMatch"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { overallPercent: 0, criteria: [] };
  }

  const obj = value as Record<string, unknown>;
  const overallPercent = clampScore(obj.overallPercent);
  const rawCriteria = Array.isArray(obj.criteria) ? obj.criteria : [];

  const criteria = rawCriteria
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => ({
      name: typeof c.name === "string" ? c.name : "Bilinmeyen",
      status: (c.status === "met" || c.status === "partial" || c.status === "unmet" ? c.status : "unmet") as "met" | "partial" | "unmet",
      detail: typeof c.detail === "string" ? c.detail : ""
    }))
    .slice(0, 12);

  return { overallPercent, criteria };
}

function sanitizeCriteriaMatch(value: AiScoreItem["criteriaMatch"]): CriteriaMatchResult | undefined {
  if (!value || !value.criteria.length) return undefined;
  return {
    overallPercent: Math.min(100, Math.max(0, Math.round(value.overallPercent))),
    criteria: value.criteria.map((c) => ({
      name: c.name,
      status: c.status,
      detail: c.detail
    }))
  };
}

function createBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function clampScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function parseIndex(value: unknown, fallbackIndex: number) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return fallbackIndex;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
