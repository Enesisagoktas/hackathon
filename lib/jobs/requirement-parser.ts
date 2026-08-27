import type { WorkMode } from "@/lib/search-preferences";

/**
 * İlan metninden "şirket tam olarak nasıl bir aday arıyor?" profilini çıkarır.
 *
 * NEDEN AYRI BİR KATMAN: Teknik benzerlik ile pozisyona uygunluk aynı şey
 * değildir. Öğrenci bir aday, "en az 3 yıl tecrübeli, üniversite mezunu"
 * arayan bir Java ilanına %95 teknik uyum gösterebilir ama o ilana
 * başvuramaz. Bu modül, eleme kararının dayandığı ZORUNLU koşulları
 * ilandan çıkarır; puanlama `eligibility.ts` içinde yapılır.
 *
 * VERİ KAYNAĞI: Kariyer.net gibi platformlar "Aday Kriterleri" bloğunu
 * yapılandırılmış yayınlar ve sözlüğü dardır (veritabanındaki 91 ilan
 * üzerinden ölçüldü):
 *   Tecrübe        → "Tecrübesiz" | "Tecrübeli / Tecrübesiz" |
 *                    "En az N yıl tecrübeli" | "En çok N yıl tecrübeli"
 *   Eğitim Seviyesi→ "Lise(Mezun), Üniversite(Öğrenci), ..." (5 seviye × 2 durum)
 *   Yabancı Dil    → "İngilizce(Okuma : İleri, Yazma : İleri, Konuşma : İleri)"
 *
 * Bu yüzden çıkarım AI tahminine değil, gerçek metne dayanır; AI erişilemese
 * bile eleme çalışır (katmanların birbirinden bağımsız olması şartı).
 */

export type EducationLevel = "lise" | "onlisans" | "universite" | "yukseklisans" | "doktora";

export type EducationRequirement = {
  level: EducationLevel;
  /** "Öğrenci" → devam eden öğrenci kabul ediliyor. */
  student: boolean;
  /** "Mezun" → mezuniyet şartı. */
  graduate: boolean;
};

export type LanguageRequirement = {
  language: string;
  /** temel < orta < iyi < ileri */
  level: "temel" | "orta" | "iyi" | "ileri" | "belirtilmemis";
};

export type EmploymentType = "staj" | "yari-zamanli" | "tam-zamanli" | "sozlesmeli" | "belirtilmemis";

export type SeniorityLevel = "stajyer" | "junior" | "orta" | "senior" | "lead" | "belirtilmemis";

/** §13 — İlanın aradığı hedef aday profili. */
export type RoleRequirementProfile = {
  minYears: number | null;
  maxYears: number | null;
  /** İlan açıkça tecrübesiz adayı kabul ediyor mu? */
  acceptsNoExperience: boolean;
  education: EducationRequirement[];
  /** Eğitim listesindeki tüm kayıtlar yalnızca "Mezun" ise mezuniyet zorunludur. */
  requiresGraduate: boolean;
  /** Eğitim listesinde en az bir "Öğrenci" varsa öğrenci kabul edilir. */
  acceptsStudent: boolean;
  languages: LanguageRequirement[];
  employmentType: EmploymentType;
  seniority: SeniorityLevel;
  /** İlan metninde ZORUNLU olarak geçen beceriler. */
  requiredSkills: string[];
  /** "tercihen / artıdır / nice to have" olarak geçen beceriler. */
  preferredSkills: string[];
  locations: string[];
  workMode: WorkMode | "any";
  /** Kaç alanın gerçekten ilandan okunabildiği — güven göstergesi. */
  extractedFields: number;
};

/**
 * Platformların kriter bloğuna eklediği reklam/gürültü metinleri.
 *
 * Ölçüm: Kariyer.net her kriter satırının sonuna "Yapay zeka ile bu pozisyona
 * özel mülakat provası yap..." ekliyor. Kesilmezse eğitim seviyesi listesi
 * bu metinle birlikte parse ediliyor.
 */
const NOISE_MARKERS = [
  "Yapay zeka",
  "Mülakat Provası",
  "mülakat provası",
  "Şirket Hakkında",
  "Yan Haklar",
  "Takipçi",
  "Takip Et",
  "Çalışan",
  "aralığındadır"
];

export function stripCriteriaNoise(value: string): string {
  let output = value;

  for (const marker of NOISE_MARKERS) {
    const index = output.indexOf(marker);
    if (index > 0) {
      output = output.slice(0, index);
    }
  }

  return output.replace(/\s+/g, " ").trim();
}

/**
 * Sayfadan yanlışlıkla çekilmiş kod/JS parçalarını eler.
 *
 * Ölçüm: bazı ilanlarda "aranan nitelikler" alanına sayfanın JavaScript'i
 * düşmüştü ("qualifications:{isLoading:a,isActive:b,...").
 */
export function looksLikeCodeNoise(value: string): boolean {
  const text = value.trim();

  if (!text) {
    return true;
  }

  if (/[{};]\s*[a-zA-Z_$][\w$]*\s*:/.test(text) && /[{}]/.test(text)) {
    return true;
  }

  const symbolCount = (text.match(/[{}\[\]<>=;|]/g) ?? []).length;
  return symbolCount / text.length > 0.08;
}

const EDUCATION_LOOKUP: Array<{ pattern: RegExp; level: EducationLevel }> = [
  { pattern: /y[üu]ksek\s*lisans/i, level: "yukseklisans" },
  { pattern: /doktora/i, level: "doktora" },
  { pattern: /[öo]n\s*lisans/i, level: "onlisans" },
  { pattern: /[üu]niversite|lisans/i, level: "universite" },
  { pattern: /lise/i, level: "lise" }
];

/** "Üniversite(Mezun), Yüksek Lisans(Öğrenci)" → yapılandırılmış liste. */
export function parseEducationRequirement(value: string): EducationRequirement[] {
  const clean = stripCriteriaNoise(value.replace(/^E[ğg]itim\s*Seviyesi/i, ""));
  const entries: EducationRequirement[] = [];

  // Array.from: derleme hedefi es5 olduğu için iterator doğrudan dönülemez.
  const matches = Array.from(clean.matchAll(/([^,()]+)\(([^)]*)\)/g));

  for (const match of matches) {
    const namePart = match[1].trim();
    const statusPart = match[2];

    // "Yüksek Lisans" içinde "lisans" da geçtiği için sıralama önemli:
    // en uzun/özgül kalıp önce denenir.
    const found = EDUCATION_LOOKUP.find((item) => item.pattern.test(namePart));
    if (!found) {
      continue;
    }

    const student = /[öo][ğg]renci/i.test(statusPart);
    const graduate = /mezun/i.test(statusPart);

    const existing = entries.find((entry) => entry.level === found.level);
    if (existing) {
      existing.student = existing.student || student;
      existing.graduate = existing.graduate || graduate;
    } else {
      entries.push({ level: found.level, student, graduate });
    }
  }

  return entries;
}

/** "En az 3 yıl tecrübeli" / "Tecrübesiz" / "Tecrübeli / Tecrübesiz" */
export function parseExperienceRequirement(value: string): {
  minYears: number | null;
  maxYears: number | null;
  acceptsNoExperience: boolean;
} {
  const clean = stripCriteriaNoise(value.replace(/^Tecr[üu]be/i, "")).trim();

  // "Tecrübeli / Tecrübesiz" → ilan her iki grubu da kabul ediyor.
  const mentionsExperienced = /tecr[üu]beli/i.test(clean);
  const mentionsInexperienced = /tecr[üu]besiz/i.test(clean);

  const minMatch = clean.match(/en\s*az\s*(\d+)\s*y[ıi]l/i);
  const maxMatch = clean.match(/en\s*[çc]ok\s*(\d+)\s*y[ıi]l/i);

  const minYears = minMatch ? Number(minMatch[1]) : null;
  const maxYears = maxMatch ? Number(maxMatch[1]) : null;

  // "Tecrübesiz" tek başına ya da "Tecrübeli / Tecrübesiz" ikilisinde geçiyorsa
  // deneyimsiz aday açıkça kabul ediliyordur.
  const acceptsNoExperience = mentionsInexperienced && !minYears;

  return {
    minYears,
    maxYears,
    acceptsNoExperience: acceptsNoExperience || (!minYears && !mentionsExperienced && !mentionsInexperienced ? false : acceptsNoExperience)
  };
}

const LANGUAGE_LEVELS: Array<{ pattern: RegExp; level: LanguageRequirement["level"] }> = [
  { pattern: /[İIi]leri/i, level: "ileri" },
  { pattern: /[İIi]yi/i, level: "iyi" },
  { pattern: /[Oo]rta/i, level: "orta" },
  { pattern: /[Tt]emel/i, level: "temel" }
];

/** "İngilizce(Okuma : İleri, Yazma : İleri, Konuşma : İleri), Almanca(...)" */
export function parseLanguageRequirement(value: string): LanguageRequirement[] {
  const clean = stripCriteriaNoise(value.replace(/^Yabanc[ıi]\s*Dil/i, ""));
  const results: LanguageRequirement[] = [];

  for (const match of Array.from(clean.matchAll(/([A-Za-zÇĞİÖŞÜçğıöşü]+)\s*\(([^)]*)\)/g))) {
    const language = match[1].trim();
    const levelText = match[2];

    if (!language || language.length < 3) {
      continue;
    }

    const found = LANGUAGE_LEVELS.find((item) => item.pattern.test(levelText));
    results.push({ language, level: found?.level ?? "belirtilmemis" });
  }

  return results;
}

// DİKKAT: Türkçe ekler yüzünden `\b` kullanılamaz — "Stajyeri" kelimesinde
// "stajyer" ile "i" arasında kelime sınırı oluşmaz ve kalıp eşleşmez.
// Bunun yerine ek alabilen gövde (`staj\w*`) eşleştirilir.
const EMPLOYMENT_PATTERNS: Array<{ pattern: RegExp; type: EmploymentType }> = [
  { pattern: /staj\w*|intern(ship)?s?\b/i, type: "staj" },
  { pattern: /yar[ıi]\s*zamanl[ıi]|part[\s-]?time/i, type: "yari-zamanli" },
  { pattern: /tam\s*zamanl[ıi]|full[\s-]?time/i, type: "tam-zamanli" },
  { pattern: /s[öo]zle[şs]meli|contract/i, type: "sozlesmeli" }
];

export function detectEmploymentType(text: string): EmploymentType {
  const found = EMPLOYMENT_PATTERNS.find((item) => item.pattern.test(text));
  return found?.type ?? "belirtilmemis";
}

const SENIORITY_PATTERNS: Array<{ pattern: RegExp; level: SeniorityLevel }> = [
  { pattern: /staj\w*|intern(ship)?s?\b/i, level: "stajyer" },
  { pattern: /\b(lead|tak[ıi]m\s*lideri|team\s*lead|mimar|architect)\b/i, level: "lead" },
  { pattern: /\b(senior|k[ıi]demli|uzman\s*seviye)\b/i, level: "senior" },
  { pattern: /\b(junior|jr\.?|giri[şs]\s*seviye|yeni\s*mezun)\b/i, level: "junior" },
  { pattern: /\b(mid|orta\s*seviye)\b/i, level: "orta" }
];

export function detectSeniority(text: string): SeniorityLevel {
  const found = SENIORITY_PATTERNS.find((item) => item.pattern.test(text));
  return found?.level ?? "belirtilmemis";
}

/**
 * §12 — Zorunlu ve tercih edilen şartları ayırır.
 *
 * Aynı cümlede "tercihen" geçen bir madde zorunlu sayılamaz; bunun tersi de
 * geçerlidir. Karar cümle bazında verilir çünkü ilanlar iki grubu tek blokta
 * karıştırır.
 */
const PREFERRED_MARKERS =
  /(tercihen|tercih\s*sebebi|art[ıi]d[ıi]r|avantaj|nice\s*to\s*have|plus|bonus|olmas[ıi]\s*(bir\s*)?art[ıi]|bilmesi\s*tercih)/i;

const REQUIRED_MARKERS =
  /(zorunlu|[şs]artt[ıi]r|gereklidir|mutlaka|must\s*have|required|aran[ıi]yor|sahip\s*olmak|deneyimli\s*olmak)/i;

export type RequirementSplit = {
  required: string[];
  preferred: string[];
};

export function splitRequirementLines(lines: string[]): RequirementSplit {
  const required: string[] = [];
  const preferred: string[] = [];

  for (const raw of lines) {
    if (looksLikeCodeNoise(raw)) {
      continue;
    }

    const clean = stripCriteriaNoise(raw);
    if (!clean || clean.length < 8) {
      continue;
    }

    // Uzun bloklar cümlelere bölünür; ilanlar zorunlu ve tercih edilen
    // maddeleri çoğu zaman tek paragrafta birleştirir.
    const sentences = clean
      .split(/(?<=[.;])\s+|\n+|(?<=,)\s(?=[A-ZÇĞİÖŞÜ])/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 8);

    for (const sentence of sentences.length ? sentences : [clean]) {
      if (PREFERRED_MARKERS.test(sentence)) {
        preferred.push(sentence);
      } else if (REQUIRED_MARKERS.test(sentence)) {
        required.push(sentence);
      } else {
        // İşaret yoksa varsayılan "zorunlu"dur: ilanlar zorunlu maddeleri
        // genelde işaretsiz yazar, tercih edilenleri açıkça belirtir.
        required.push(sentence);
      }
    }
  }

  return { required, preferred };
}

export type ListingTextInput = {
  title: string;
  description: string;
  requirements?: string[];
  candidateCriteria?: string[];
  location?: string;
  workMode?: WorkMode;
};

/** İlanın tamamından hedef aday profilini çıkarır. */
export function extractRoleRequirements(listing: ListingTextInput): RoleRequirementProfile {
  const criteria = (listing.candidateCriteria ?? []).map((line) => String(line));
  const requirementLines = (listing.requirements ?? []).map((line) => String(line));

  let minYears: number | null = null;
  let maxYears: number | null = null;
  let acceptsNoExperience = false;
  let education: EducationRequirement[] = [];
  let languages: LanguageRequirement[] = [];
  let extractedFields = 0;

  for (const line of criteria) {
    if (/^Tecr[üu]be/i.test(line.trim())) {
      const parsed = parseExperienceRequirement(line);
      minYears = parsed.minYears;
      maxYears = parsed.maxYears;
      acceptsNoExperience = parsed.acceptsNoExperience;
      extractedFields += 1;
    } else if (/^E[ğg]itim\s*Seviyesi/i.test(line.trim())) {
      education = parseEducationRequirement(line);
      if (education.length) {
        extractedFields += 1;
      }
    } else if (/^Yabanc[ıi]\s*Dil/i.test(line.trim())) {
      languages = parseLanguageRequirement(line);
      if (languages.length) {
        extractedFields += 1;
      }
    }
  }

  const fullText = [listing.title, listing.description, ...requirementLines, ...criteria]
    .filter(Boolean)
    .join("\n");

  const { required, preferred } = splitRequirementLines(
    requirementLines.length ? requirementLines : [listing.description]
  );

  const employmentType = detectEmploymentType(`${listing.title}\n${listing.description}`);
  const seniority = detectSeniority(`${listing.title}\n${listing.description}`);

  if (employmentType !== "belirtilmemis") {
    extractedFields += 1;
  }
  if (seniority !== "belirtilmemis") {
    extractedFields += 1;
  }

  // Deneyim yılı kriter bloğunda yoksa serbest metinden okunmaya çalışılır.
  if (minYears === null) {
    const inline = fullText.match(/en\s*az\s*(\d+)\s*y[ıi]l/i);
    if (inline) {
      minYears = Number(inline[1]);
      extractedFields += 1;
    }
  }

  return {
    minYears,
    maxYears,
    acceptsNoExperience,
    education,
    requiresGraduate: education.length > 0 && education.every((item) => item.graduate && !item.student),
    acceptsStudent: education.some((item) => item.student),
    languages,
    employmentType,
    seniority,
    requiredSkills: required,
    preferredSkills: preferred,
    locations: listing.location ? [listing.location] : [],
    workMode: listing.workMode ?? "any",
    extractedFields
  };
}
