import { getWorkModeDisplay } from "@/lib/search-preferences";
import type { CandidateProfile, CrawledJobListing, CriteriaItem, CriteriaMatchResult, JobSearchResult } from "@/lib/jobs/types";
import { truncateText } from "@/lib/jobs/normalize";
import { generateJsonWithGemini } from "@/lib/gemini";
import {
  BAND_LABELS,
  buildCandidateEligibility,
  evaluateEligibility,
  type CandidateEligibility,
  type EligibilityResult
} from "@/lib/jobs/eligibility";
import { extractRoleRequirements } from "@/lib/jobs/requirement-parser";
import { computeFreshness } from "@/lib/jobs/freshness";

const BATCH_SIZE = 4;
// Scoring is bounded and runs in parallel so a slow/unavailable Gemini never
// blocks the worker. A single attempt keeps the worst case ~SCORING_TIMEOUT_MS.
const SCORING_TIMEOUT_MS = Number(process.env.AI_SCORING_TIMEOUT_MS ?? 28000);
const SCORING_MAX_ATTEMPTS = Number(process.env.AI_SCORING_MAX_ATTEMPTS ?? 1);
// Kullanıcı "aktif ilanların tamamı listelensin" istiyor: AI'ya giden aday
// sayısı ve sonuç tavanı geniş tutulur. Süre, worker akışında sorun değil.
const MAX_SCORED_CANDIDATES = Number(process.env.AI_MAX_SCORED ?? 60);
const MAX_RESULTS = Number(process.env.AI_MAX_RESULTS ?? 100);
// Bu skorun altındaki ilanlar alaka eşiğini geçemez ve listeye girmez.
const MIN_RELEVANT_SCORE = Number(process.env.AI_MIN_RELEVANT_SCORE ?? 30);

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

export type ScoringOutcome = {
  results: JobSearchResult[];
  /** Zorunlu şart ihlali nedeniyle elenen ilanlar (§11 Katman 1). */
  rejected?: Array<{ listing: CrawledJobListing; blockers: { code: string; label: string; detail: string }[] }>;
  /**
   * AI'nın FİİLEN karar verdiği ilanların URL'leri (hem kabul hem ret).
   *
   * Çağıran taraf bunu "bu ilanlar bir daha skorlanmasın" listesi olarak
   * kullanır. Batch'i çöktüğü için hiç değerlendirilemeyen ilanlar bu kümeye
   * GİRMEZ; böylece sonraki turda yeniden denenebilirler.
   */
  evaluatedUrls: Set<string>;
};

/**
 * AI-powered semantic scoring using Gemini.
 * No keyword fallback. If AI fails, the jobs are not scored.
 */
export async function scoreListingsWithAi(
  listings: CrawledJobListing[],
  profile: CandidateProfile
): Promise<ScoringOutcome> {
  if (!profile.cvSummary && !profile.fullText) {
    console.warn("No CV text available for AI scoring; returning cheap-scored results.");
    const fallback = listings.slice(0, MAX_SCORED_CANDIDATES);
    return { results: buildUnscoredResults(fallback), evaluatedUrls: new Set<string>() };
  }

  const topCandidates = listings.slice(0, MAX_SCORED_CANDIDATES);
  const batches = createBatches(topCandidates, BATCH_SIZE);
  // Aday profili bir kez çıkarılır; her ilan için yeniden hesaplanmasına gerek yok.
  const candidateEligibility = buildCandidateEligibility(profile);

  // Run every batch concurrently. A failed or slow batch never blocks the
  // others, and its listings fall back to cheap-scored real results.
  const settled = await Promise.allSettled(batches.map((batch) => scoreBatchWithAi(batch, profile)));

  const scored: JobSearchResult[] = [];
  const leftover: CrawledJobListing[] = [];
  const evaluatedUrls = new Set<string>();
  /** Hard filter'a takılan ilanlar — kullanıcıya "kaç ilan neden elendi" denir. */
  const rejected: Array<{ listing: CrawledJobListing; blockers: { code: string; label: string; detail: string }[] }> = [];
  /** Feature #3 — elenenlerin sonuç nesneleri (gerekçeli, kullanıcıya gösterilebilir). */
  const rejectedResults: JobSearchResult[] = [];

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

      if (!aiScore) {
        // AI bu ilan için satır döndürmedi: değerlendirilmemiş sayılır ve
        // sonraki turda yeniden denenebilir.
        leftover.push(listing);
        return;
      }

      evaluatedUrls.add(listing.url);

      if (aiScore.score >= MIN_RELEVANT_SCORE) {
        const result = buildScoredResult(listing, aiScore, `${batchIndex}-${j}`, candidateEligibility);

        // §11 + Feature #3 — Zorunlu şart ihlali ilanı UYGUN listesinden çıkarır
        // ama artık ÇÖPE ATMAZ: elenenler gerekçeleriyle (blockers) ayrı tutulur,
        // kullanıcı "neden uygun değil?" sorusunun cevabını görebilir. Gerekçeler
        // eligibility motorunun deterministik blocker'larıdır — AI uydurmaz.
        if (result.eligibility && !result.eligibility.eligible) {
          rejected.push({ listing, blockers: result.eligibility.blockers });
          rejectedResults.push(result);
          return;
        }

        scored.push(result);
      }
      // Düşük puanlılar bilinçli olarak elenir; listeye dolgu yapılmaz.
    });
  });

  // AI tamamen çökmüşse (hiçbir ilan değerlendirilemediyse) anahtar kelime
  // sıralı gerçek ilanlar gösterilir — bunlar düşük güvenlidir ve otomatik
  // gönderilmez. AI EN AZ BİR ilanı değerlendirebildiyse dolgu YAPILMAZ:
  // "hemşire CV'sine ofis personeli önerme" hatası tam bu dolgudan çıkıyordu.
  if (evaluatedUrls.size === 0 && leftover.length) {
    return { results: buildUnscoredResults(topCandidates), evaluatedUrls };
  }

  // Uygunlar önce; ELENENLER listenin sonuna sınırlı sayıda eklenir (ana
  // sonuçları domine etmesinler — şartname kuralı). Sıralama katmanı zaten
  // eligible=false olanları en alta koyar; arayüz varsayılan olarak gizler.
  const MAX_REJECTED_SHOWN = 15;
  const results = [
    ...scored.sort((left, right) => right.matchScore - left.matchScore).slice(0, MAX_RESULTS),
    ...rejectedResults.sort((left, right) => right.matchScore - left.matchScore).slice(0, MAX_REJECTED_SHOWN)
  ].map((result, index) => ({ ...result, id: `${result.id}:${index + 1}` }));

  if (rejected.length) {
    const reasons = new Map<string, number>();
    for (const item of rejected) {
      for (const blocker of item.blockers) {
        reasons.set(blocker.label, (reasons.get(blocker.label) ?? 0) + 1);
      }
    }
    const summary = Array.from(reasons.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => `${label} (${count})`)
      .join(", ");
    console.log(`[score] ${rejected.length} ilan zorunlu şart nedeniyle elendi — ${summary}`);
  }

  return { results, evaluatedUrls, rejected };
}

/**
 * §11 — AI skorunu katmanlı uygunlukla birleştirir.
 *
 * AI skoru "bu CV bu ilana ne kadar benziyor" sorusunu iyi cevaplıyor ama
 * "aday bu ilana başvurabilir mi" sorusunu cevaplayamıyor. Bu yüzden:
 *   • Pozisyon uygunluğu (60 puan) tamamen deterministik motordan gelir.
 *   • Teknik uyum (40 puan) deterministik kapsama ile AI skorunun ortalamasıdır;
 *     AI, kelime eşleşmesinin göremediği anlamsal yakınlığı yakalar.
 *   • Zorunlu şart ihlali varsa skor ne olursa olsun ilan elenir.
 */
export function combineWithEligibility(
  listing: CrawledJobListing,
  candidate: CandidateEligibility,
  aiScore: number,
  matchedKeywords: string[]
): { eligibility: EligibilityResult; finalScore: number } {
  const role = extractRoleRequirements({
    title: listing.title,
    description: listing.description,
    requirements: listing.requirements,
    candidateCriteria: listing.candidateCriteria,
    location: listing.location,
    workMode: listing.workMode
  });

  const eligibility = evaluateEligibility(role, candidate, {
    listingVerified: true,
    listingKeywords: [listing.title, ...matchedKeywords]
  });

  const blendedTechnical = (eligibility.technicalScore + (aiScore / 100) * 40) / 2;

  // Feature #2 — tazelik küçük bir düzeltme olarak PUANA işlenir (±3);
  // ayrı sıralama ekseni değildir. Böylece gösterilen sayı ile sıra aynı
  // kalır ve uyumluluğu asla domine edemez.
  const freshness = computeFreshness(listing.postedAt);
  const finalScore = Math.round(
    Math.max(0, Math.min(100, eligibility.roleScore + blendedTechnical + freshness.adjust))
  );

  return {
    eligibility: { ...eligibility, technicalScore: Math.round(blendedTechnical * 10) / 10, totalScore: finalScore },
    finalScore
  };
}

function toEligibilitySummary(result: EligibilityResult) {
  return {
    eligible: result.eligible,
    blockers: result.blockers.map((item) => ({ code: item.code, label: item.label, detail: item.detail })),
    roleScore: result.roleScore,
    technicalScore: result.technicalScore,
    band: result.band,
    bandLabel: BAND_LABELS[result.band],
    roleComponents: result.roleComponents,
    technicalComponents: result.technicalComponents,
    confidence: result.requirementConfidence
  };
}

function buildScoredResult(
  listing: CrawledJobListing,
  aiScore: AiScoreItem,
  idSuffix: string,
  candidate?: CandidateEligibility
): JobSearchResult {
  const combined = candidate
    ? combineWithEligibility(listing, candidate, aiScore.score, aiScore.matchedKeywords ?? [])
    : null;

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
    matchScore: combined?.finalScore ?? aiScore.score,
    matchReasons: aiScore.reasons.slice(0, 5),
    confidence: aiScore.score >= 75 ? "high" : aiScore.score >= 50 ? "medium" : "low",
    eligibility: combined ? toEligibilitySummary(combined.eligibility) : undefined,
    freshness: computeFreshness(listing.postedAt).label ?? undefined,
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

Puanlama: 85-100 çok güçlü, 70-84 iyi, 50-69 orta, 30-49 düşük, 0-29 uyumsuz. Kıdem uyumsuzluğu puanı düşürür.

MESLEK UYUMU (en önemli kural): İlanın meslek alanı adayın meslek alanından
farklıysa (örnek: aday hemşire, ilan ofis personeli/yazılımcı/satış) skoru
0-15 aralığında ver. Yüzeysel kelime benzerliği (ör. ikisinde de "iletişim"
geçmesi) meslek uyumu SAYILMAZ.`;

  const extraDirectives: string[] = [];

  if (profile.desiredSeniority) {
    extraDirectives.push(
      `Kullanıcı özellikle "${profile.desiredSeniority}" seviyesinde ilan arıyor; bu seviyeye uymayan ilanların skorunu belirgin düşür (örn. stajyer arayana senior ilanı 30'un altı).`
    );
  }

  if (profile.searchNote) {
    extraDirectives.push(
      `Kullanıcının arama notu: "${profile.searchNote}". Bu nottaki anahtar ifadeleri karşılayan ilanlara ek puan ver, notla çelişen ilanların puanını düşür.`
    );
  }

  const directiveBlock = extraDirectives.length
    ? ["", "KULLANICI TERCİHLERİ:", ...extraDirectives.map((item) => `- ${item}`), ""].join("\n")
    : "";

  const prompt = `ADAY PROFİLİ:
${cvContext}
${directiveBlock}
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
  if (profile.desiredSeniority) parts.push(`Aranan Seviye: ${profile.desiredSeniority}`);
  if (profile.searchNote) parts.push(`Kullanıcı Notu: ${profile.searchNote}`);

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
