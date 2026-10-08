import { generateJsonWithGemini } from "@/lib/gemini";
import { normalizeComparable } from "@/lib/jobs/normalize";
import { splitSkillSegment } from "@/lib/cv/skill-dictionary";
import type {
  ContactInfo,
  EducationEntry,
  ExperienceEntry,
  LanguageEntry,
  ProjectEntry,
  StructuredCv
} from "@/lib/cv/types";

/**
 * Ham CV metnini bölümlere ayırır. Uyarlama katmanının tek gerçek kaynağı budur:
 * `TailoredCv` içine giren her şey burada bir karşılığı olmak zorundadır.
 *
 * Gemini yoksa veya hata verirse kural tabanlı ayrıştırıcıya düşer; akış hiçbir
 * durumda durmaz.
 */
export async function extractStructuredCv(text: string): Promise<StructuredCv> {
  try {
    const parsed = await generateJsonWithGemini<Record<string, unknown>>(
      SYSTEM_INSTRUCTION,
      `Aşağıdaki CV metnini bölümlere ayır:\n\n${text.slice(0, 16000)}`,
      { timeoutMs: Number(process.env.CV_STRUCTURE_TIMEOUT_MS ?? 30000) }
    );

    const structured = sanitizeStructuredCv(parsed, text, "ai");

    // AI boş/anlamsız döndürdüyse heuristic sonuç daha iyidir.
    if (structured.experience.length || structured.skills.length >= 3) {
      return structured;
    }
  } catch (error) {
    console.warn("[structured-cv] Gemini ayrıştırma başarısız, kural tabanlı yedeğe düşülüyor:", errorMessage(error));
  }

  return buildHeuristicStructuredCv(text);
}

const SYSTEM_INSTRUCTION = `Sen bir CV ayrıştırıcısısın. Verilen CV metnini yapılandırılmış JSON'a çevirirsin.

MUTLAKA bu şemaya uy:
{
  "contact": { "fullName": string, "email": string, "phone": string, "location": string, "links": string[] },
  "headline": string,
  "summary": string,
  "experience": [ { "role": string, "company": string, "period": string, "location": string, "bullets": string[], "skills": string[] } ],
  "education": [ { "degree": string, "school": string, "period": string, "detail": string } ],
  "skills": string[],
  "certifications": string[],
  "languages": [ { "name": string, "level": string } ],
  "projects": [ { "name": string, "detail": string, "skills": string[] } ],
  "extras": string[]
}

MUTLAK KURALLAR:
- SADECE metinde geçen bilgiyi çıkar. Hiçbir şey uydurma, tahmin etme, tamamlama.
- Bir alan metinde yoksa boş string veya boş dizi bırak.
- bullets: CV'de yazan görev/başarı ifadelerini olduğu gibi al, süsleme.
- skills (deneyim içindeki): sadece o deneyimin metninde fiilen geçen araç/teknoloji/yetkinlik.
- extras: yukarıdaki bölümlere girmeyen ama önemli olabilecek satırlar (referans, ödül, gönüllülük, ehliyet, askerlik).
- Tarihleri CV'deki biçimiyle koru.`;

// ─── Sanitize ─────────────────────────────────────────────────────────────

function sanitizeStructuredCv(parsed: Record<string, unknown>, rawText: string, source: "ai" | "heuristic"): StructuredCv {
  const contactRaw = asRecord(parsed.contact);

  const contact: ContactInfo = {
    fullName: asString(contactRaw.fullName) ?? guessFullName(rawText) ?? "",
    email: asString(contactRaw.email) ?? findEmail(rawText),
    phone: asString(contactRaw.phone) ?? findPhone(rawText),
    location: asString(contactRaw.location),
    links: asStringArray(contactRaw.links).slice(0, 6)
  };

  return {
    contact,
    headline: asString(parsed.headline),
    summary: asString(parsed.summary),
    experience: asArray(parsed.experience).map(toExperience).filter((item) => item.role.length > 1).slice(0, 12),
    education: asArray(parsed.education).map(toEducation).filter((item) => item.degree.length > 1).slice(0, 8),
    skills: dedupe(asStringArray(parsed.skills)).slice(0, 60),
    certifications: dedupe(asStringArray(parsed.certifications)).slice(0, 20),
    languages: asArray(parsed.languages).map(toLanguage).filter((item) => item.name.length > 1).slice(0, 10),
    projects: asArray(parsed.projects).map(toProject).filter((item) => item.name.length > 1).slice(0, 10),
    extras: dedupe(asStringArray(parsed.extras)).slice(0, 15),
    source
  };
}

function toExperience(value: unknown): ExperienceEntry {
  const record = asRecord(value);
  return {
    role: asString(record.role) ?? "",
    company: asString(record.company),
    period: asString(record.period),
    location: asString(record.location),
    bullets: dedupe(asStringArray(record.bullets)).slice(0, 12),
    skills: dedupe(asStringArray(record.skills)).slice(0, 20)
  };
}

function toEducation(value: unknown): EducationEntry {
  const record = asRecord(value);
  return {
    degree: asString(record.degree) ?? "",
    school: asString(record.school),
    period: asString(record.period),
    detail: asString(record.detail)
  };
}

function toLanguage(value: unknown): LanguageEntry {
  if (typeof value === "string") {
    return { name: value.trim() };
  }
  const record = asRecord(value);
  return { name: asString(record.name) ?? "", level: asString(record.level) };
}

function toProject(value: unknown): ProjectEntry {
  const record = asRecord(value);
  return {
    name: asString(record.name) ?? "",
    detail: asString(record.detail),
    skills: dedupe(asStringArray(record.skills)).slice(0, 12)
  };
}

// ─── Kural tabanlı yedek ayrıştırıcı ──────────────────────────────────────

/**
 * Bölüm başlıklarını tanıyan desenler.
 *
 * Desenler ASCII'ye normalize edilmiş metne uygulanır (`normalizeComparable`:
 * Türkçe locale ile küçültme + ı/ğ/ü/ş/ö/ç sadeleştirmesi). Bunun sebebi:
 * JavaScript'in /i/ bayrağı Türkçe "İ" (U+0130) ile "i" harflerini EŞLEŞTİRMEZ,
 * ve varsayılan toLowerCase() "İ" için birleşik noktalı "i̇" üretir. Bu yüzden
 * /^iş deneyimi/i deseni "İŞ DENEYİMİ" başlığını yakalayamaz — büyük harfli
 * Türkçe CV'lerin tamamı sessizce ayrıştırılamaz hale gelir.
 */
const SECTION_PATTERNS: Array<[keyof SectionBuckets, RegExp]> = [
  ["summary", /^(profil|profesyonel ozet|ozet|hakkimda|kariyer hedefi|kariyer ozeti|summary|profile|about( me)?|objective)\b/],
  ["experience", /^(is deneyimi?|deneyim|is tecrubesi|calisma gecmisi|profesyonel deneyim|tecrube|is gecmisi|work experience|experience|employment( history)?)\b/],
  ["education", /^(egitim( bilgileri| durumu)?|ogrenim|akademik( gecmis)?|education|academic)\b/],
  ["skills", /^(beceriler?|yetkinlikler?|yetenekler|teknik beceriler|uzmanlik( alanlari)?|skills|technical skills|competencies)\b/],
  ["certifications", /^(sertifikalar?|kurslar?|egitimler ve sertifikalar|belgeler|certificat(es|ions)|courses|licenses)\b/],
  ["languages", /^(diller?( bilgisi)?|dil bilgisi|yabanci dil(ler)?|languages?)\b/],
  ["projects", /^(projeler?|calismalar|portfolyo|portfoy|projects?|portfolio)\b/],
  ["extras", /^(referanslar?|oduller?|gonullu( calismalar)?|hobiler|ilgi alanlari|ehliyet|askerlik( durumu)?|references|awards|volunteer|interests|hobbies)\b/]
];

type SectionBuckets = {
  summary: string[];
  experience: string[];
  education: string[];
  skills: string[];
  certifications: string[];
  languages: string[];
  projects: string[];
  extras: string[];
  header: string[];
};

/** Gemini yokken CV'yi bölümlere ayıran kural tabanlı ayrıştırıcı. */
export function buildHeuristicStructuredCv(text: string): StructuredCv {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const buckets: SectionBuckets = {
    summary: [], experience: [], education: [], skills: [],
    certifications: [], languages: [], projects: [], extras: [], header: []
  };

  let current: keyof SectionBuckets = "header";

  for (const line of lines) {
    const heading = matchSectionHeading(line);

    if (heading) {
      current = heading;
      // "Beceriler: React, Node" gibi tek satırlık başlıklarda içerik kaybolmasın.
      const inline = line.replace(/^[^:]*:\s*/, "");
      if (inline && inline !== line && inline.length > 2) {
        buckets[current].push(inline);
      }
      continue;
    }

    buckets[current].push(line);
  }

  const headerText = buckets.header.join("\n");

  return {
    contact: {
      fullName: guessFullName(text) ?? "",
      email: findEmail(text),
      phone: findPhone(text),
      location: findLocation(headerText),
      links: findLinks(text)
    },
    headline: buckets.header.find((line) => looksLikeHeadline(line)),
    summary: buckets.summary.join(" ").slice(0, 900) || undefined,
    experience: parseExperienceLines(buckets.experience),
    education: parseEducationLines(buckets.education),
    skills: parseSkillLines(buckets.skills),
    certifications: buckets.certifications.map(stripBullet).filter((item) => item.length > 2).slice(0, 20),
    languages: parseLanguageLines(buckets.languages),
    projects: parseProjectLines(buckets.projects),
    extras: buckets.extras.map(stripBullet).filter((item) => item.length > 3).slice(0, 15),
    source: "heuristic"
  };
}

function matchSectionHeading(line: string): keyof SectionBuckets | null {
  // Başlıklar kısa olur; uzun cümleleri başlık sayma.
  if (line.length > 60) {
    return null;
  }

  // ASCII'ye indir: "İŞ DENEYİMİ" → "is deneyimi", "BECERİLER" → "beceriler".
  const cleaned = normalizeComparable(line);

  if (!cleaned) {
    return null;
  }

  for (const [section, pattern] of SECTION_PATTERNS) {
    if (pattern.test(cleaned)) {
      return section;
    }
  }

  return null;
}

/** "Rol — Şirket (2020 - 2023)" gibi satırları başlık, kalanını madde sayar. */
function parseExperienceLines(lines: string[]): ExperienceEntry[] {
  const entries: ExperienceEntry[] = [];
  let current: ExperienceEntry | null = null;

  for (const raw of lines) {
    const line = stripBullet(raw);
    if (line.length < 3) {
      continue;
    }

    const isBullet = /^[•\-–—*·]/.test(raw.trim()) || /^\d+[.)]\s/.test(raw.trim());
    const period = findPeriod(line);

    if (!isBullet && (period || (entries.length === 0 && !current))) {
      const withoutPeriod = period ? line.replace(period, "").trim() : line;
      const parts = withoutPeriod.split(/\s+[|–—@]\s+|\s+-\s+|,\s+/).map((part) => part.trim()).filter(Boolean);

      current = {
        role: parts[0] ?? withoutPeriod,
        company: parts[1],
        period,
        location: parts[2],
        bullets: [],
        skills: []
      };
      entries.push(current);
      continue;
    }

    if (current) {
      current.bullets.push(line);
    } else {
      current = { role: line, bullets: [], skills: [] };
      entries.push(current);
    }
  }

  return entries.slice(0, 12).map((entry) => ({ ...entry, bullets: entry.bullets.slice(0, 12) }));
}

function parseEducationLines(lines: string[]): EducationEntry[] {
  return lines
    .map(stripBullet)
    .filter((line) => line.length > 4)
    .slice(0, 8)
    .map((line) => {
      const period = findPeriod(line);
      const withoutPeriod = period ? line.replace(period, "").trim() : line;
      const parts = withoutPeriod.split(/\s+[|–—]\s+|\s+-\s+|,\s+/).map((part) => part.trim()).filter(Boolean);
      return {
        degree: parts[0] ?? withoutPeriod,
        school: parts[1],
        period,
        detail: parts.slice(2).join(", ") || undefined
      };
    });
}

function parseSkillLines(lines: string[]): string[] {
  return dedupe(
    lines
      .flatMap((line) => stripBullet(line).split(/[,;|•·]|\s+\/\s+/))
      // PDF'lerde beceriler sık sık "etiket" düzeniyle çizilir ve metin
      // çıkarımında aralarına boşluk KARAKTERİ girmez:
      //   "ReactNext.jsTypeScriptJavaScriptReduxTailwind CSSHTMLCSSGitREST"
      // Böyle blokları sözlükle ayırırız; aksi halde uzunluk filtresine takılıp
      // becerilerin tamamı sessizce kaybolur.
      .flatMap(splitSkillSegment)
      .map((item) => item.replace(/\(.*?\)/g, "").trim())
      .filter((item) => item.length >= 2 && item.length <= 40)
  ).slice(0, 60);
}

function parseLanguageLines(lines: string[]): LanguageEntry[] {
  return dedupe(lines.flatMap((line) => stripBullet(line).split(/[,;|•·]/)))
    .map((item) => item.trim())
    .filter((item) => item.length >= 3)
    .slice(0, 10)
    .map((item) => {
      const match = item.match(/^(.*?)[\s:(-]+((?:A1|A2|B1|B2|C1|C2|başlangıç|orta|iyi|ileri|akıcı|ana ?dil|anadili|native|fluent|advanced|intermediate|basic).*)$/i);
      return match ? { name: match[1].trim(), level: match[2].replace(/\)$/, "").trim() } : { name: item };
    });
}

function parseProjectLines(lines: string[]): ProjectEntry[] {
  return lines
    .map(stripBullet)
    .filter((line) => line.length > 4)
    .slice(0, 10)
    .map((line) => {
      const [name, ...rest] = line.split(/\s*[:–—-]\s+/);
      return { name: name.trim(), detail: rest.join(" - ").trim() || undefined, skills: [] };
    });
}

// ─── Metin yardımcıları ───────────────────────────────────────────────────

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
// TR cep/sabit hat: +90 5xx xxx xx xx, 05xx..., (0212) ...
const PHONE_PATTERN = /(?:\+90[\s.-]?)?\(?0?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/;
const LINK_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com|gitlab\.com|behance\.net|dribbble\.com|medium\.com)\/[^\s,;)]+/gi;

export function findEmail(text: string): string | undefined {
  return text.match(EMAIL_PATTERN)?.[0];
}

export function findPhone(text: string): string | undefined {
  return text.match(PHONE_PATTERN)?.[0]?.trim();
}

function findLinks(text: string): string[] {
  return dedupe(text.match(LINK_PATTERN) ?? []).slice(0, 6);
}

/** İletişim bloğunda geçen ili yakalar. */
const CITY_LOOKUP: Array<[string, string]> = [
  ["istanbul", "İstanbul"], ["ankara", "Ankara"], ["izmir", "İzmir"], ["bursa", "Bursa"],
  ["antalya", "Antalya"], ["adana", "Adana"], ["konya", "Konya"], ["gaziantep", "Gaziantep"],
  ["kocaeli", "Kocaeli"], ["mersin", "Mersin"], ["kayseri", "Kayseri"], ["eskisehir", "Eskişehir"],
  ["samsun", "Samsun"], ["denizli", "Denizli"], ["sakarya", "Sakarya"], ["trabzon", "Trabzon"]
];

/**
 * NOT: Burada `\b` KULLANILMAZ. JavaScript'te `\b` sınırı `\w` = [A-Za-z0-9_]
 * ile tanımlıdır; "İ" bu kümede olmadığı için "· İstanbul" içinde "İ"den önce
 * sınır oluşmaz ve /\bİstanbul/ eşleşmez. Bu yüzden karşılaştırma ASCII'ye
 * normalize edilmiş metin üzerinden yapılır.
 */
function findLocation(text: string): string | undefined {
  const normalized = normalizeComparable(text);

  for (const [key, label] of CITY_LOOKUP) {
    if (new RegExp(`(^|[^a-z0-9])${key}([^a-z0-9]|$)`).test(normalized)) {
      return label;
    }
  }

  return undefined;
}

/** İlk anlamlı satırı ad-soyad adayı olarak alır (e-posta/telefon/başlık değilse). */
function guessFullName(text: string): string | undefined {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 8);

  for (const line of lines) {
    if (line.length < 4 || line.length > 60) continue;
    if (EMAIL_PATTERN.test(line) || PHONE_PATTERN.test(line)) continue;
    if (/\d/.test(line)) continue;
    if (/(cv|özgeçmiş|resume|curriculum)/i.test(line)) continue;

    const words = line.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 && words.every((word) => /^[A-Za-zÇĞİÖŞÜçğıöşü'.-]+$/.test(word))) {
      return line;
    }
  }

  return undefined;
}

function looksLikeHeadline(line: string): boolean {
  return line.length > 5 && line.length < 70 &&
    /(developer|engineer|specialist|manager|uzman|mühendis|geliştirici|analist|danışman|sorumlu|müdür|designer|tasarımcı)/i.test(line);
}

function findPeriod(line: string): string | undefined {
  const match = line.match(
    /((?:0?[1-9]|1[0-2])[./]\d{4}|\d{4})\s*[-–—/]\s*((?:0?[1-9]|1[0-2])[./]\d{4}|\d{4}|halen|devam|günümüz|present|current|now)/i
  );
  return match?.[0];
}

function stripBullet(line: string): string {
  return line.replace(/^[\s•\-–—*·▪◦]+/, "").replace(/^\d+[.)]\s*/, "").trim();
}

// ─── Küçük yardımcılar ────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

export function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of items) {
    const key = item.toLocaleLowerCase("tr-TR");
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }

  return out;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
