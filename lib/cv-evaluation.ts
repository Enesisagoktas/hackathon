import type { CvAnalysis } from "@/lib/extract-keywords";
import { generateJsonWithGemini } from "@/lib/gemini";

export type CvScoreBreakdown = {
  format: number;
  personalInfo: number;
  professionalSummary: number;
  experience: number;
  education: number;
  skills: number;
  certificates: number;
  languages: number;
};

export type CvFitAnalysis = {
  high: string[];
  medium: string[];
  low: string[];
};

export type CvEvaluation = {
  source: "ai" | "heuristic";
  score: number;
  category: string;
  professionCategory: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  improvementSuggestions: string[];
  fitAnalysis: CvFitAnalysis;
  scoreBreakdown: CvScoreBreakdown;
  riskSignals: string[];
};

type EvaluateCvInput = {
  text: string;
  keywordAnalysis: CvAnalysis;
  fileType: "pdf" | "docx";
};

/**
 * AI-powered CV evaluation using Gemini.
 * No heuristic fallbacks.
 */
export async function evaluateCv({ text, keywordAnalysis, fileType }: EvaluateCvInput): Promise<CvEvaluation> {
  const systemInstruction = "Sen Türkiye pazarını bilen deneyimli bir İK uzmanısın. CV'yi 100 puan üzerinden değerlendir. Sadece geçerli JSON döndür. Adayı hukuka aykırı yaş, cinsiyet, medeni durum gibi kriterlerle değerlendirme. Stajyer özel değerlendirmesini yapma.";
  
  const prompt = createAiPrompt(text, keywordAnalysis, fileType);
  
  const parsed = await generateJsonWithGemini<Partial<CvEvaluation>>(systemInstruction, prompt);
  
  return sanitizeEvaluation(parsed, "ai");
}

function createAiPrompt(text: string, keywordAnalysis: CvAnalysis, fileType: "pdf" | "docx") {
  return `
CV metni aşağıda. Türkiye'deki gerçek İK değerlendirme mantığına göre analiz et.

Puanlama boyutları ve maksimum puanlar:
- format: 8
- personalInfo: 5
- professionalSummary: 10
- experience: 35
- education: 15
- skills: 12
- certificates: 10
- languages: 5

İstenen JSON şeması:
{
  "score": number,
  "category": string,
  "professionCategory": string,
  "summary": string,
  "strengths": string[],
  "weaknesses": string[],
  "improvementSuggestions": string[],
  "fitAnalysis": { "high": string[], "medium": string[], "low": string[] },
  "scoreBreakdown": { "format": number, "personalInfo": number, "professionalSummary": number, "experience": number, "education": number, "skills": number, "certificates": number, "languages": number },
  "riskSignals": string[]
}

Değerlendirme ilkeleri:
- Profesyonel özet var mı, spesifik mi, ölçülebilir kanıt içeriyor mu?
- Deneyim bölümü rol, süre, şirket, başarı metriği ve kariyer sürekliliği açısından güçlü mü?
- Başarılar sadece görev listesi mi yoksa sayısal katkı içeriyor mu?
- Eğitim, sertifika ve dil bilgileri rol için yeterli sinyal veriyor mu?
- CV hangi meslek kategorisine daha yakın?
- Bu CV ile kabul ihtimali yüksek, orta ve düşük olan rol/platform stratejilerini yaz.
- CV puanını yükseltmek için net, uygulanabilir öneriler ver.

Dosya tipi: ${fileType}
Çıkarılan beceriler: ${keywordAnalysis.skills.join(", ") || "Yok"}
Çıkarılan pozisyonlar: ${keywordAnalysis.titles.join(", ") || "Yok"}
Çıkarılan diller: ${keywordAnalysis.languages.join(", ") || "Yok"}

CV metni:
${text.slice(0, 12000)}
`;
}

function sanitizeEvaluation(value: Partial<CvEvaluation>, source: "ai" | "heuristic"): CvEvaluation {
  const scoreBreakdown = {
    format: clampNumber(value.scoreBreakdown?.format, 0, 8),
    personalInfo: clampNumber(value.scoreBreakdown?.personalInfo, 0, 5),
    professionalSummary: clampNumber(value.scoreBreakdown?.professionalSummary, 0, 10),
    experience: clampNumber(value.scoreBreakdown?.experience, 0, 35),
    education: clampNumber(value.scoreBreakdown?.education, 0, 15),
    skills: clampNumber(value.scoreBreakdown?.skills, 0, 12),
    certificates: clampNumber(value.scoreBreakdown?.certificates, 0, 10),
    languages: clampNumber(value.scoreBreakdown?.languages, 0, 5)
  };
  const fallbackScore = Object.values(scoreBreakdown).reduce((sum, item) => sum + item, 0);
  const score = clampNumber(value.score, 0, 100) || fallbackScore;

  return {
    source,
    score,
    category: value.category || getScoreCategory(score),
    professionCategory: value.professionCategory || "Genel aday profili",
    summary: value.summary || "CV genel İK kriterlerine göre değerlendirildi.",
    strengths: sanitizeStringArray(value.strengths),
    weaknesses: sanitizeStringArray(value.weaknesses),
    improvementSuggestions: sanitizeStringArray(value.improvementSuggestions),
    fitAnalysis: {
      high: sanitizeStringArray(value.fitAnalysis?.high),
      medium: sanitizeStringArray(value.fitAnalysis?.medium),
      low: sanitizeStringArray(value.fitAnalysis?.low)
    },
    scoreBreakdown,
    riskSignals: sanitizeStringArray(value.riskSignals)
  };
}

function getScoreCategory(score: number) {
  if (score >= 82) return "Yüksek uyum";
  if (score >= 62) return "İyi aday";
  if (score >= 45) return "Orta uyum";
  if (score >= 25) return "Zayıf uyum";
  return "Düşük uyum";
}

function sanitizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 8);
}

function clampNumber(value: unknown, min: number, max: number) {
  return clamp(typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0, min, max);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
