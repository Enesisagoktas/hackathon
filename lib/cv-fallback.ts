import { normalizeComparable } from "@/lib/jobs/normalize";
import type { AiExtractedProfile } from "@/lib/extract-keywords";
import type { CvEvaluation } from "@/lib/cv-evaluation";

/**
 * Heuristic (rule-based) fallbacks used when Gemini is unavailable
 * (missing key, 403, timeout). They keep the demo working end-to-end:
 * the user always sees a profile, an evaluation and real listings.
 */

// Canonical skill labels. Matched case-insensitively against the normalized CV.
const SKILL_DICTIONARY = [
  "JavaScript", "TypeScript", "React", "Next.js", "Vue", "Angular", "Node.js", "Express",
  "NestJS", "HTML", "CSS", "Tailwind", "Redux", "GraphQL", "REST", "Python", "Django",
  "Flask", "Java", "Spring Boot", "Kotlin", "Swift", "C#", ".NET", "PHP", "Laravel",
  "Go", "Rust", "Ruby", "Rails", "SQL", "MySQL", "PostgreSQL", "MongoDB", "Redis",
  "Docker", "Kubernetes", "AWS", "Azure", "GCP", "Terraform", "Git", "CI/CD", "Linux",
  "React Native", "Flutter", "Android", "iOS", "Selenium", "Cypress", "Playwright",
  "Jest", "Figma", "Photoshop", "Illustrator", "InDesign", "Power BI", "Tableau",
  "Excel", "pandas", "TensorFlow", "PyTorch", "scikit-learn", "Kafka", "RabbitMQ",
  "Salesforce", "HubSpot", "SAP", "Logo", "Mikro", "Netsis", "SEO", "Google Ads",
  "Meta Ads", "Google Analytics", "AutoCAD", "MS Project", "Scrum", "Agile", "Jira",
  "Pazarlama", "Satış", "İhracat", "Dış Ticaret", "Muhasebe", "Lojistik",
  "İnsan Kaynakları", "Proje Yönetimi", "İş Geliştirme", "Müşteri İlişkileri"
];

const LANGUAGES: Array<[string, RegExp]> = [
  ["İngilizce", /\b(ingilizce|english)\b/i],
  ["Türkçe", /\b(turkce|turkish)\b/i],
  ["Almanca", /\b(almanca|german|deutsch)\b/i],
  ["Fransızca", /\b(fransizca|french)\b/i],
  ["İspanyolca", /\b(ispanyolca|spanish|espanol)\b/i],
  ["Arapça", /\b(arapca|arabic)\b/i],
  ["Rusça", /\b(rusca|russian)\b/i],
  ["İtalyanca", /\b(italyanca|italian)\b/i]
];

const TITLE_RULES: Array<[RegExp, string[]]> = [
  [/react native|flutter|android|ios|mobil/, ["Mobile Developer", "Mobil Uygulama Geliştirici"]],
  [/react|next|vue|angular|frontend|front-end|ön ?yüz/, ["Frontend Developer", "Frontend Geliştirici"]],
  [/node|express|nestjs|django|flask|spring|\.net|backend|back-end|php|laravel/, ["Backend Developer", "Backend Geliştirici"]],
  [/full ?stack/, ["Full Stack Developer"]],
  [/docker|kubernetes|devops|terraform|ci\/cd|sre/, ["DevOps Engineer", "DevOps Mühendisi"]],
  [/data scien|machine learning|tensorflow|pytorch|makine ogrenmesi/, ["Data Scientist", "Veri Bilimci"]],
  [/data analyst|power bi|tableau|veri analiz/, ["Data Analyst", "Veri Analisti"]],
  [/qa|test otomasyon|selenium|cypress|test uzman/, ["QA Engineer", "Test Mühendisi"]],
  [/ui\/ux|ux|ui design|figma|kullanici deneyim/, ["UI/UX Designer", "Ürün Tasarımcısı"]],
  [/product manager|urun yonet/, ["Product Manager", "Ürün Yöneticisi"]],
  [/ihracat|export|dis ticaret|foreign trade/, ["İhracat Pazarlama Uzmanı", "Export Specialist"]],
  [/dijital pazarlama|google ads|meta ads|seo|digital marketing/, ["Dijital Pazarlama Uzmanı", "Digital Marketing Specialist"]],
  [/satis|sales|b2b/, ["Satış Uzmanı", "Sales Specialist"]],
  [/muhasebe|mali musavir|accounting/, ["Muhasebe Uzmanı", "Accountant"]],
  [/insan kaynaklari|ik uzman|human resources/, ["İnsan Kaynakları Uzmanı", "HR Specialist"]],
  [/lojistik|tedarik zinciri|logistics|supply chain/, ["Lojistik Uzmanı", "Logistics Specialist"]],
  [/finans|finance|fp&a/, ["Finans Analisti", "Financial Analyst"]],
  [/proje yonet|project manager|pmp/, ["Proje Yöneticisi", "Project Manager"]],
  [/grafik|graphic design/, ["Grafik Tasarımcı", "Graphic Designer"]],
  [/muhendis|engineer/, ["Mühendis"]]
];

const EDUCATION_RULES: Array<[RegExp, string]> = [
  [/doktora|phd|ph\.d/i, "doktora"],
  [/yuksek lisans|master|m\.?sc|mba/i, "yüksek lisans"],
  [/lisans|universite|bachelor|b\.?sc|fakulte/i, "lisans"],
  [/on lisans|önlisans|associate/i, "ön lisans"],
  [/lise|high school/i, "lise"]
];

export function buildHeuristicProfile(text: string): AiExtractedProfile {
  const normalized = normalizeComparable(text);

  const skills = SKILL_DICTIONARY.filter((skill) => normalized.includes(normalizeComparable(skill)));
  const languages = LANGUAGES.filter(([, pattern]) => pattern.test(normalized)).map(([label]) => label);
  const titles = inferTitles(normalized, skills);
  const yearsOfExperience = detectYears(normalized);
  const seniority = inferSeniority(yearsOfExperience, normalized);
  const educationLevel = detectEducation(text);
  const professionCategory = titles[0] ?? "Genel aday profili";

  const experienceAreas = deriveExperienceAreas(skills, titles);
  const industries = detectIndustries(normalized);
  const searchKeywords = uniqueLimited([...titles, ...skills, ...industries], 40);

  return {
    source: "heuristic",
    skills: skills.slice(0, 25),
    titles: titles.slice(0, 8),
    languages: languages.length ? languages : ["Türkçe"],
    experienceAreas: experienceAreas.slice(0, 10),
    industries: industries.slice(0, 10),
    searchKeywords,
    aiProfile: {
      seniority,
      yearsOfExperience,
      targetPositions: titles.slice(0, 6),
      certifications: [],
      educationLevel,
      preferredRoles: titles.slice(0, 6),
      queryVariations: uniqueLimited([...titles, ...skills.slice(0, 8)], 20),
      cvSummary: buildSummary(titles, skills, yearsOfExperience),
      professionCategory
    }
  };
}

export function buildHeuristicEvaluation(
  text: string,
  skills: string[],
  titles: string[]
): Partial<CvEvaluation> {
  const normalized = normalizeComparable(text);
  const length = text.trim().length;

  const hasEmail = /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text);
  const hasPhone = /(\+?\d[\d\s().-]{8,})/.test(text);
  const hasExperience = /(deneyim|tecrube|experience|yil|yıl|sirket|şirket|firma|pozisyon)/i.test(normalized);
  const hasEducation = EDUCATION_RULES.some(([pattern]) => pattern.test(text));
  const hasSummary = /(ozet|özet|hakkimda|hakkımda|profil|summary|objective)/i.test(normalized);
  const hasCertificate = /(sertifika|certificate|certified|lisans belgesi)/i.test(normalized);
  const languageCount = LANGUAGES.filter(([, pattern]) => pattern.test(normalized)).length;

  const scoreBreakdown = {
    format: length > 600 ? 7 : 4,
    personalInfo: (hasEmail ? 3 : 0) + (hasPhone ? 2 : 0),
    professionalSummary: hasSummary ? 7 : 3,
    experience: hasExperience ? Math.min(35, 18 + Math.min(12, Math.floor(length / 400))) : 10,
    education: hasEducation ? 12 : 5,
    skills: Math.min(12, 3 + skills.length),
    certificates: hasCertificate ? 7 : 2,
    languages: Math.min(5, languageCount * 2 + 1)
  };

  const total = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);

  return {
    source: "heuristic",
    score: total,
    professionCategory: titles[0] ?? "Genel aday profili",
    summary:
      "Bu değerlendirme, yapay zekâ servisi geçici olarak kullanılamadığı için kural tabanlı (heuristic) yöntemle üretildi. CV temel bölümler açısından otomatik olarak puanlandı.",
    strengths: buildStrengths(skills, titles, hasExperience, hasEducation),
    weaknesses: buildWeaknesses(hasSummary, hasCertificate, skills.length),
    improvementSuggestions: [
      "Deneyim maddelerine ölçülebilir başarılar (yüzde, tutar, süre) ekleyin.",
      "CV başına 2-3 cümlelik net bir profesyonel özet yazın.",
      "Hedeflediğiniz role uygun anahtar kelimeleri öne çıkarın."
    ],
    fitAnalysis: {
      high: titles.slice(0, 2),
      medium: titles.slice(2, 4),
      low: []
    },
    scoreBreakdown,
    riskSignals: skills.length === 0 ? ["CV'den otomatik beceri çıkarılamadı; beceriler bölümünü güçlendirin."] : []
  };
}

// ─── Internals ─────────────────────────────────────────────────────────────

function inferTitles(normalized: string, skills: string[]): string[] {
  const titles: string[] = [];
  for (const [pattern, roles] of TITLE_RULES) {
    if (pattern.test(normalized)) {
      titles.push(...roles);
    }
  }
  if (!titles.length && skills.length) {
    titles.push("Uzman");
  }
  return uniqueLimited(titles, 8);
}

function deriveExperienceAreas(skills: string[], titles: string[]): string[] {
  const areas = new Set<string>();
  if (titles[0]) areas.add(titles[0]);
  if (skills.some((s) => /react|vue|angular|frontend/i.test(s))) areas.add("Frontend geliştirme");
  if (skills.some((s) => /node|django|spring|\.net|backend/i.test(s))) areas.add("Backend geliştirme");
  if (skills.some((s) => /sql|power bi|tableau|pandas/i.test(s))) areas.add("Veri ve raporlama");
  if (skills.some((s) => /satis|pazarlama|ihracat/i.test(s))) areas.add("Satış ve pazarlama");
  return Array.from(areas);
}

function detectIndustries(normalized: string): string[] {
  const industries: string[] = [];
  const map: Array<[RegExp, string]> = [
    [/yazilim|teknoloji|bilisim|software|technology/, "Teknoloji"],
    [/banka|finans|sigorta|fintech/, "Finans"],
    [/perakende|retail|e-?ticaret|e-?commerce/, "Perakende / E-ticaret"],
    [/otomotiv|automotive/, "Otomotiv"],
    [/uretim|imalat|fabrika|manufacturing/, "Üretim"],
    [/lojistik|tasimacilik|logistics/, "Lojistik"],
    [/saglik|health/, "Sağlık"],
    [/egitim|education/, "Eğitim"]
  ];
  for (const [pattern, label] of map) {
    if (pattern.test(normalized)) industries.push(label);
  }
  return industries;
}

function detectYears(normalized: string): number | undefined {
  const match = normalized.match(/(\d{1,2})\s*(\+)?\s*(yil|year)/);
  if (match) {
    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.min(40, value) : undefined;
  }
  return undefined;
}

function inferSeniority(years: number | undefined, normalized: string): string {
  if (/\b(lead|principal|staff)\b/.test(normalized)) return "lead";
  if (/\b(mudur|müdür|manager|direktor)\b/.test(normalized)) return "manager";
  if (/\b(stajyer|intern)\b/.test(normalized)) return "intern";
  if (years == null) return "mid";
  if (years <= 1) return "junior";
  if (years <= 4) return "mid";
  if (years <= 8) return "senior";
  return "lead";
}

function detectEducation(text: string): string | undefined {
  for (const [pattern, label] of EDUCATION_RULES) {
    if (pattern.test(text)) return label;
  }
  return undefined;
}

function buildSummary(titles: string[], skills: string[], years: number | undefined): string {
  const role = titles[0] ?? "aday";
  const skillText = skills.slice(0, 5).join(", ") || "çeşitli alanlarda beceriler";
  const expText = years != null ? `${years} yıla yakın deneyimi olan` : "ilgili alanda deneyimi olan";
  return `${expText} bir ${role}. Öne çıkan beceriler: ${skillText}.`;
}

function buildStrengths(skills: string[], titles: string[], hasExperience: boolean, hasEducation: boolean): string[] {
  const out: string[] = [];
  if (skills.length >= 5) out.push(`Geniş beceri seti (${skills.slice(0, 5).join(", ")}).`);
  if (titles.length) out.push(`Net hedef rol sinyali: ${titles[0]}.`);
  if (hasExperience) out.push("Deneyim bölümü mevcut.");
  if (hasEducation) out.push("Eğitim bilgisi belirtilmiş.");
  return out.length ? out : ["CV temel bilgileri içeriyor."];
}

function buildWeaknesses(hasSummary: boolean, hasCertificate: boolean, skillCount: number): string[] {
  const out: string[] = [];
  if (!hasSummary) out.push("Profesyonel özet bölümü eksik görünüyor.");
  if (!hasCertificate) out.push("Sertifika/lisans bilgisi tespit edilemedi.");
  if (skillCount < 5) out.push("Beceri listesi sınırlı; daha fazla teknik/profesyonel beceri ekleyin.");
  return out.length ? out : ["Belirgin bir eksik tespit edilmedi (otomatik analiz)."];
}

function uniqueLimited(items: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLocaleLowerCase("tr-TR");
    if (item && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
    if (out.length >= limit) break;
  }
  return out;
}
