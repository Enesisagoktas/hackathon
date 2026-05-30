import type { AiCvProfile } from "@/lib/jobs/types";
import { generateJsonWithGemini } from "@/lib/gemini";
import { buildHeuristicProfile } from "@/lib/cv-fallback";

export type CvAnalysis = {
  skills: string[];
  titles: string[];
  languages: string[];
  experienceAreas: string[];
  industries: string[];
  searchKeywords: string[];
};

export type AiExtractedProfile = CvAnalysis & {
  aiProfile: AiCvProfile;
  /** "ai" when Gemini produced it, "heuristic" when the rule-based fallback ran. */
  source?: "ai" | "heuristic";
};

/**
 * Extract a rich CV profile using Gemini AI.
 * Falls back to a rule-based heuristic profile when Gemini is unavailable
 * (missing key, 403, timeout) so the flow never dead-ends on a blank screen.
 */
export async function extractProfileFromCv(text: string): Promise<AiExtractedProfile> {
  try {
    return await extractProfileWithGemini(text);
  } catch (error) {
    console.error("[extractProfileFromCv] Gemini failed, using heuristic fallback:", error);
    return buildHeuristicProfile(text);
  }
}

async function extractProfileWithGemini(text: string): Promise<AiExtractedProfile> {
  const cvText = text.slice(0, 14000);

  const systemInstruction = `Sen uzman bir İK analisti ve CV parserısın. Verilen CV metnini analiz edip yapılandırılmış JSON çıktı üret.

MUTLAKA aşağıdaki JSON şemasına uy:
{
  "skills": string[],           // CV'deki tüm teknik ve profesyonel beceriler (en az 5, en fazla 25)
  "titles": string[],           // Adayın uygun olduğu pozisyon unvanları (TR ve EN, en az 3, en fazla 8)
  "languages": string[],        // Bildiği diller
  "experienceAreas": string[],  // Deneyim alanları (ör: "Frontend geliştirme", "B2B Satış", "İhracat Pazarlama")
  "industries": string[],       // Çalıştığı/uygun olduğu sektörler
  "searchKeywords": string[],   // İş aramasında kullanılacak anahtar kelimeler (TR ve EN karışık, en az 15, en fazla 40)
  "seniority": string,          // "intern" | "junior" | "mid" | "senior" | "lead" | "manager" | "director" | "c-level"
  "yearsOfExperience": number,  // Toplam deneyim yılı tahmini
  "lastRole": string,           // Son çalıştığı pozisyon
  "lastCompany": string,        // Son çalıştığı şirket
  "targetPositions": string[],  // Hedeflemesi gereken pozisyonlar (TR ve EN, en az 4)
  "certifications": string[],   // Sertifikalar ve lisanslar
  "education": string,          // Eğitim bilgisi özeti
  "educationLevel": string,     // "lise" | "ön lisans" | "lisans" | "yüksek lisans" | "doktora"
  "achievements": string[],     // Somut başarılar ve metrikler
  "projectDetails": string[],   // Önemli proje detayları
  "preferredRoles": string[],   // Aday için uygun roller (geniş düşün)
  "unwantedRoles": string[],    // Uygun olmayacak roller
  "companySummary": string,     // Kısa kariyer özeti (2-3 cümle)
  "queryVariations": string[],  // İş arama için Türkçe VE İngilizce sorgu varyasyonları (en az 10, en fazla 20)
  "cvSummary": string,          // 3-4 cümlelik CV özeti (ilan eşleştirme için kullanılacak)
  "professionCategory": string  // Ana meslek kategorisi
}

Kurallar:
- searchKeywords hem Türkçe hem İngilizce olmalı
- queryVariations özellikle önemli: adayın hedef rolüyle ilgili farklı ifade biçimleri, eş anlamlılar, sektör terimleri dahil olmalı
- Örnek: "Export Marketing Specialist" için queryVariations: ["ihracat pazarlama uzmanı", "dış ticaret pazarlama", "export specialist", "international marketing", "B2B marketing", "trade marketing", "uluslararası pazarlama", "export sales", "foreign trade"]
- titles ve targetPositions hem Türkçe hem İngilizce olmalı
- Skills listesinde CV'de geçen TÜM becerileri çıkar, sadece bilinen teknolojilerle sınırlama
- Seniority'yi deneyim yılı ve rol seviyesinden çıkar
- CV'de yoksa boş string veya boş array döndür, tahmin etme`;

  const parsed = await generateJsonWithGemini<Record<string, unknown>>(
    systemInstruction,
    `Aşağıdaki CV metnini analiz et:\n\n${cvText}`
  );

  return sanitizeAiProfile(parsed);
}

function sanitizeAiProfile(parsed: Record<string, unknown>): AiExtractedProfile {
  const skills = toStringArray(parsed.skills).slice(0, 25);
  const titles = toStringArray(parsed.titles).slice(0, 8);
  const languages = toStringArray(parsed.languages).slice(0, 10);
  const experienceAreas = toStringArray(parsed.experienceAreas).slice(0, 10);
  const industries = toStringArray(parsed.industries).slice(0, 10);
  const searchKeywords = toStringArray(parsed.searchKeywords).slice(0, 40);

  return {
    source: "ai",
    skills,
    titles,
    languages,
    experienceAreas,
    industries,
    searchKeywords,
    aiProfile: {
      seniority: toSafeString(parsed.seniority),
      yearsOfExperience: toSafeNumber(parsed.yearsOfExperience),
      lastRole: toSafeString(parsed.lastRole),
      lastCompany: toSafeString(parsed.lastCompany),
      targetPositions: toStringArray(parsed.targetPositions).slice(0, 10),
      certifications: toStringArray(parsed.certifications).slice(0, 10),
      education: toSafeString(parsed.education),
      educationLevel: toSafeString(parsed.educationLevel),
      achievements: toStringArray(parsed.achievements).slice(0, 10),
      projectDetails: toStringArray(parsed.projectDetails).slice(0, 8),
      preferredRoles: toStringArray(parsed.preferredRoles).slice(0, 10),
      unwantedRoles: toStringArray(parsed.unwantedRoles).slice(0, 10),
      companySummary: toSafeString(parsed.companySummary),
      queryVariations: toStringArray(parsed.queryVariations).slice(0, 20),
      cvSummary: toSafeString(parsed.cvSummary),
      professionCategory: toSafeString(parsed.professionCategory)
    }
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 40);
}

function toSafeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function toSafeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}
