import { getWorkModeDisplay } from "@/lib/search-preferences";
import type { CandidateProfile, CrawledJobListing, CriteriaItem, CriteriaMatchResult, JobSearchResult } from "@/lib/jobs/types";
import { truncateText } from "@/lib/jobs/normalize";
import { generateJsonWithGemini } from "@/lib/gemini";

const BATCH_SIZE = 5;

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
    console.warn("No CV text available for AI scoring");
    return [];
  }

  const topCandidates = listings.slice(0, 15);
  const batches = createBatches(topCandidates, BATCH_SIZE);
  const allResults: JobSearchResult[] = [];
  let globalIndex = 0;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      if (i > 0) {
        console.log(`[AI Scoring] Rate limit: Waiting 30 seconds before next batch...`);
        await sleep(30000);
      }
      
      const aiScores = await scoreBatchWithAi(batch, profile);

      for (let j = 0; j < batch.length; j++) {
        const aiScore = aiScores.find((s) => s.index === j);
        const listing = batch[j];

        if (aiScore && aiScore.score >= 20) {
          allResults.push({
            id: `${listing.platform}:${listing.externalId ?? listing.url}:${globalIndex}`,
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
            criteriaMatch: sanitizeCriteriaMatch(aiScore.criteriaMatch)
          });
        }

        globalIndex++;
      }
    } catch (error) {
      console.error("AI batch scoring failed:", error);
      globalIndex += batch.length;
    }
  }

  return allResults
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, 30)
    .map((result, index) => ({ ...result, id: `${result.id}:${index + 1}` }));
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
    description: listing.description.slice(0, 1500),
    requirements: listing.requirements?.slice(0, 5).join("; ") ?? ""
  }));

  const cvContext = buildCvContext(profile);

  const systemInstruction = `Sen uzman bir İK eşleştirme motorusun. Aday profili ile iş ilanlarını semantik olarak karşılaştırıp uyum skoru ve detaylı kriter analizi veriyorsun.

MUTLAKA aşağıdaki JSON şemasına uy:
{
  "scores": [
    {
      "index": number,
      "score": number,
      "reasons": string[],
      "missingSkills": string[],
      "seniorityFit": string,
      "matchedKeywords": string[],
      "criteriaMatch": {
        "overallPercent": number,
        "criteria": [
          {
            "name": string,
            "status": "met" | "partial" | "unmet",
            "detail": string
          }
        ]
      }
    }
  ]
}

criteriaMatch kuralları:
- overallPercent: Adayın ilanın gereksinimlerini yüzde kaç karşıladığı (0-100)
- criteria dizisinde ŞU KATEGORİLERİ MUTLAKA değerlendir:
  1. "Teknik Beceriler"
  2. "Deneyim Süresi"
  3. "Kıdem Seviyesi"
  4. "Eğitim"
  5. "Dil Yetkinliği"
  6. "Sertifikalar"
  7. "Sektör Deneyimi"
  8. "Lokasyon"
- Eğer ilan metninde o kriter hakkında bilgi yoksa, status "met" yap ve detail'de "İlanda bu kriter belirtilmemiş" yaz
- Her kriter için detail alanında Türkçe, 1-2 cümlelik net bir açıklama yaz

Puanlama kuralları:
- 85-100: Rol, sektör, beceri ve kıdem çok güçlü örtüşüyor
- 70-84: İyi eşleşme, küçük eksikler var
- 50-69: Orta uyum, bazı beceriler veya deneyim eksik
- 30-49: Düşük uyum, önemli farklar var
- 0-29: Neredeyse hiç uyum yok
- Seniority uyumsuzluğu ciddi puan düşürücüdür`;

  const prompt = `ADAY PROFİLİ:
${cvContext}

İŞ İLANLARI (${listingSummaries.length} adet):
${JSON.stringify(listingSummaries, null, 2)}

Her ilan için uyum skorunu ve detaylı kriter analizini hesapla.`;

  const parsed = await generateJsonWithGemini<{ scores: Record<string, unknown>[] }>(systemInstruction, prompt);

  return (parsed.scores ?? []).map((item) => ({
    index: typeof item.index === "number" ? item.index : 0,
    score: clampScore(item.score),
    reasons: toStringArray(item.reasons).slice(0, 5),
    missingSkills: toStringArray(item.missingSkills).slice(0, 6),
    seniorityFit: typeof item.seniorityFit === "string" ? item.seniorityFit : "belirsiz",
    matchedKeywords: toStringArray(item.matchedKeywords).slice(0, 10),
    criteriaMatch: parseCriteriaMatch(item.criteriaMatch)
  }));
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
    parts.push(`\nCV Tam Metin (kısaltılmış):\n${profile.fullText.slice(0, 4000)}`);
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

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
