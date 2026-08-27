import { normalizeComparable } from "@/lib/jobs/normalize";
import type { CandidateProfile } from "@/lib/jobs/types";
import type {
  EducationLevel,
  EmploymentType,
  RoleRequirementProfile,
  SeniorityLevel
} from "@/lib/jobs/requirement-parser";
import type { LocationMode, WorkMode } from "@/lib/search-preferences";

/**
 * Katmanlı aday uygunluğu (§11).
 *
 * ÇÖZDÜĞÜ HATA: Tek bir AI benzerlik skoru, "bu CV bu ilana benziyor mu?"
 * sorusunu cevaplar; oysa gereken cevap "bu aday bu ilana başvurabilir mi?"
 * sorusunundur. Öğrenci bir aday, "üniversite mezunu, en az 3 yıl deneyimli"
 * arayan bir Java ilanıyla %95 teknik uyum gösterebilir ama o ilan ona kapalıdır.
 * Eski akışta kıdem uyumsuzluğu yalnızca "puanı düşürüyordu" ve ilan listede
 * kalıyordu.
 *
 * KATMANLAR
 *   0 — İlan geçerliliği   : ilan gerçek/aktif/doğrulanmış değilse elenir
 *   1 — Hard filter        : zorunlu şart karşılanmıyorsa skor ne olursa olsun elenir
 *   2 — Pozisyon uygunluğu : 60 puan (deneyim 20, tür 15, eğitim 10, konum 10, dil 5)
 *   3 — Teknik uyum        : 40 puan (beceri 15, teknoloji 10, deneyim ilişkisi 10, kelime 5)
 *
 * Teknik uyum ile pozisyon uygunluğu BİLİNÇLİ OLARAK ayrı tutulur; ikisi asla
 * birbirini telafi edemez.
 */

export type BlockerCode =
  | "listing-invalid"
  | "graduate-required"
  | "experience-below-min"
  | "seniority-mismatch"
  | "employment-mismatch"
  | "location-mismatch"
  | "language-missing";

export type HardBlocker = {
  code: BlockerCode;
  /** Kullanıcıya gösterilecek kısa başlık. */
  label: string;
  /** Neden elendiğinin tek cümlelik açıklaması. */
  detail: string;
};

export type ScoreComponent = {
  key: string;
  label: string;
  earned: number;
  max: number;
  status: "met" | "partial" | "unmet" | "unknown";
  detail: string;
};

export type EligibilityBand = "cok-guclu" | "cok-uygun" | "uygun" | "sinirda" | "uygun-degil";

export type EligibilityResult = {
  /** Hard filter'ı geçti mi? False ise ilan listelenmemeli. */
  eligible: boolean;
  blockers: HardBlocker[];
  /** 0-60 */
  roleScore: number;
  /** 0-40 */
  technicalScore: number;
  /** 0-100 */
  totalScore: number;
  band: EligibilityBand;
  roleComponents: ScoreComponent[];
  technicalComponents: ScoreComponent[];
  /** Karşılanan zorunlu şart oranı — sıralamada kullanılır. */
  requiredCoverage: number;
  /** İlandan kaç şart okunabildi; düşükse karar temkinli verilir. */
  requirementConfidence: "high" | "medium" | "low";
};

export type CandidateEligibility = {
  seniority: SeniorityLevel;
  yearsOfExperience: number | null;
  isStudent: boolean;
  educationLevel: EducationLevel | null;
  languages: string[];
  locations: string[];
  locationMode: LocationMode;
  workMode: WorkMode;
  skills: string[];
  keywords: string[];
  /** Kullanıcının aradığı çalışma türü (arayüzdeki seviye filtresinden). */
  desiredEmployment: EmploymentType;
  desiredSeniority: SeniorityLevel;
};

const SENIORITY_ORDER: Record<SeniorityLevel, number> = {
  stajyer: 0,
  junior: 1,
  orta: 2,
  senior: 3,
  lead: 4,
  belirtilmemis: -1
};

const EDUCATION_ORDER: Record<EducationLevel, number> = {
  lise: 0,
  onlisans: 1,
  universite: 2,
  yukseklisans: 3,
  doktora: 4
};

function normalizeSeniority(value: string | undefined): SeniorityLevel {
  if (!value) {
    return "belirtilmemis";
  }

  const text = normalizeComparable(value);

  if (/staj|intern/.test(text)) return "stajyer";
  if (/lead|mimar|architect|takim lideri/.test(text)) return "lead";
  if (/senior|kidemli/.test(text)) return "senior";
  if (/junior|yeni mezun|giris/.test(text)) return "junior";
  if (/mid|orta/.test(text)) return "orta";

  return "belirtilmemis";
}

function normalizeEducation(value: string | undefined): EducationLevel | null {
  if (!value) {
    return null;
  }

  const text = normalizeComparable(value);

  if (/doktora|phd/.test(text)) return "doktora";
  if (/yuksek lisans|master/.test(text)) return "yukseklisans";
  if (/on lisans|onlisans|associate/.test(text)) return "onlisans";
  if (/universite|lisans|bachelor|muhendis/.test(text)) return "universite";
  if (/lise|high school/.test(text)) return "lise";

  return null;
}

/** CV analizinden çıkan profili uygunluk motorunun beklediği yapıya çevirir. */
export function buildCandidateEligibility(profile: CandidateProfile): CandidateEligibility {
  const educationText = profile.educationLevel ?? "";
  const seniority = normalizeSeniority(profile.seniority);
  const desiredSeniority = normalizeSeniority(profile.desiredSeniority);

  // Öğrencilik, tek bir alandan değil birden çok işaretten okunur; CV
  // analizinde bu bilgi bazen eğitim satırında, bazen kıdemde geçiyor.
  const isStudent =
    /[öo][ğg]renci|student|devam\s*ediyor|s[üu]r[üu]yor/i.test(educationText) ||
    seniority === "stajyer" ||
    desiredSeniority === "stajyer";

  return {
    seniority,
    yearsOfExperience: typeof profile.yearsOfExperience === "number" ? profile.yearsOfExperience : null,
    isStudent,
    educationLevel: normalizeEducation(educationText),
    languages: (profile.languages ?? []).map((item) => normalizeComparable(item)).filter(Boolean),
    locations: profile.locations ?? [],
    locationMode: profile.locationMode,
    workMode: profile.workMode,
    skills: (profile.skills ?? []).map((item) => normalizeComparable(item)).filter(Boolean),
    keywords: (profile.keywords ?? []).map((item) => normalizeComparable(item)).filter(Boolean),
    desiredEmployment: desiredSeniority === "stajyer" ? "staj" : "belirtilmemis",
    desiredSeniority
  };
}

// ─── Katman 1: Hard filter ────────────────────────────────────────────────

/**
 * Zorunlu şartları kontrol eder. Bir blocker varsa ilan skoru ne olursa olsun elenir.
 *
 * TEMKİN İLKESİ: bir şart İLANDAN OKUNAMADIYSA veya ADAY HAKKINDA
 * BİLİNMİYORSA eleme yapılmaz. Yanlış eleme, yanlış öneriden daha pahalıdır;
 * bilinmeyen durumlarda karar puanlamaya bırakılır.
 */
export function findHardBlockers(
  role: RoleRequirementProfile,
  candidate: CandidateEligibility
): HardBlocker[] {
  const blockers: HardBlocker[] = [];

  // 1. Mezuniyet şartı — ilanın eğitim listesi yalnızca "(Mezun)" içeriyorsa.
  if (role.requiresGraduate && candidate.isStudent) {
    blockers.push({
      code: "graduate-required",
      label: "Mezuniyet şartı",
      detail: "İlan yalnızca mezun adayları kabul ediyor; profilin öğrenci olarak görünüyor."
    });
  }

  // 2. Minimum deneyim — ilan açıkça tecrübesiz kabul ediyorsa uygulanmaz.
  if (
    role.minYears !== null &&
    !role.acceptsNoExperience &&
    candidate.yearsOfExperience !== null &&
    candidate.yearsOfExperience < role.minYears
  ) {
    blockers.push({
      code: "experience-below-min",
      label: "Deneyim şartı",
      detail: `İlan en az ${role.minYears} yıl deneyim istiyor; profilinde ${candidate.yearsOfExperience} yıl görünüyor.`
    });
  }

  // 3. Kıdem — aday ilanın istediği seviyenin belirgin altındaysa.
  const roleRank = SENIORITY_ORDER[role.seniority];
  const candidateRank = SENIORITY_ORDER[candidate.seniority];

  if (roleRank >= SENIORITY_ORDER.senior && candidateRank >= 0 && candidateRank <= SENIORITY_ORDER.junior) {
    blockers.push({
      code: "seniority-mismatch",
      label: "Kıdem uyumsuzluğu",
      detail: `İlan ${role.seniority === "lead" ? "takım lideri" : "kıdemli"} seviyede; profilin ${
        candidate.seniority === "stajyer" ? "stajyer" : "giriş"
      } seviyesinde.`
    });
  }

  // 4. Çalışma türü — kullanıcı staj arıyorsa kıdemli tam zamanlı ilan uygun değildir.
  if (candidate.desiredEmployment === "staj" && role.employmentType !== "staj" && roleRank >= SENIORITY_ORDER.senior) {
    blockers.push({
      code: "employment-mismatch",
      label: "Çalışma türü",
      detail: "Staj arıyorsun; bu ilan kıdemli tam zamanlı bir pozisyon."
    });
  }

  // 5. Zorunlu konum — kullanıcı şehir seçtiyse ve ilan uzaktan değilse.
  if (candidate.locationMode === "cities" && candidate.locations.length && role.locations.length) {
    const wanted = candidate.locations.map((city) => normalizeComparable(city)).filter(Boolean);
    const listingLocations = role.locations.map((city) => normalizeComparable(city)).filter(Boolean);
    const overlaps = listingLocations.some((listing) => wanted.some((city) => listing.includes(city)));

    if (!overlaps && role.workMode !== "remote" && candidate.workMode !== "remote") {
      blockers.push({
        code: "location-mismatch",
        label: "Konum",
        detail: `İlan ${role.locations[0]} konumunda; seçtiğin şehirler arasında değil.`
      });
    }
  }

  // 6. Zorunlu dil — YALNIZCA "ileri" seviye şartında ve adayın dil listesi
  //    okunabilmişse. Dil listesi boşsa CV'den çıkarılamamış olabilir; bu
  //    durumda eleme yapmak yanlış olur.
  const advancedLanguage = role.languages.find((item) => item.level === "ileri");

  if (advancedLanguage && candidate.languages.length > 0) {
    const needle = normalizeComparable(advancedLanguage.language);
    const hasLanguage = candidate.languages.some((item) => item.includes(needle) || needle.includes(item));

    if (!hasLanguage) {
      blockers.push({
        code: "language-missing",
        label: "Dil şartı",
        detail: `İlan ileri seviye ${advancedLanguage.language} istiyor; CV'nde bu dil görünmüyor.`
      });
    }
  }

  return blockers;
}

// ─── Katman 2: Pozisyon uygunluğu (60 puan) ───────────────────────────────

function scoreExperience(role: RoleRequirementProfile, candidate: CandidateEligibility): ScoreComponent {
  const max = 20;

  if (role.minYears === null && role.maxYears === null && !role.acceptsNoExperience) {
    return { key: "experience", label: "Deneyim seviyesi", earned: max * 0.7, max, status: "unknown", detail: "İlanda deneyim şartı belirtilmemiş." };
  }

  if (candidate.yearsOfExperience === null) {
    return { key: "experience", label: "Deneyim seviyesi", earned: max * 0.6, max, status: "unknown", detail: "CV'den deneyim yılı okunamadı." };
  }

  const years = candidate.yearsOfExperience;

  if (role.acceptsNoExperience) {
    return { key: "experience", label: "Deneyim seviyesi", earned: max, max, status: "met", detail: "İlan tecrübesiz adayları kabul ediyor." };
  }

  if (role.minYears !== null && years >= role.minYears) {
    // Üst sınırı aşan aday için küçük bir düşüş: ilan daha junior arıyor olabilir.
    if (role.maxYears !== null && years > role.maxYears) {
      return { key: "experience", label: "Deneyim seviyesi", earned: max * 0.6, max, status: "partial", detail: `İlan en çok ${role.maxYears} yıl deneyim arıyor; sende ${years} yıl var.` };
    }
    return { key: "experience", label: "Deneyim seviyesi", earned: max, max, status: "met", detail: `İlan en az ${role.minYears} yıl istiyor; sende ${years} yıl var.` };
  }

  if (role.maxYears !== null && years <= role.maxYears) {
    return { key: "experience", label: "Deneyim seviyesi", earned: max, max, status: "met", detail: `Deneyimin ilanın aradığı aralıkta.` };
  }

  return { key: "experience", label: "Deneyim seviyesi", earned: 0, max, status: "unmet", detail: "Deneyim şartı karşılanmıyor." };
}

function scoreRoleType(role: RoleRequirementProfile, candidate: CandidateEligibility): ScoreComponent {
  const max = 15;
  const roleRank = SENIORITY_ORDER[role.seniority];
  const candidateRank = SENIORITY_ORDER[candidate.seniority];

  if (roleRank < 0) {
    return { key: "role-type", label: "Pozisyon türü", earned: max * 0.7, max, status: "unknown", detail: "İlanda kıdem seviyesi belirtilmemiş." };
  }

  if (candidateRank < 0) {
    return { key: "role-type", label: "Pozisyon türü", earned: max * 0.6, max, status: "unknown", detail: "CV'den kıdem seviyesi okunamadı." };
  }

  const gap = Math.abs(roleRank - candidateRank);

  if (gap === 0) {
    return { key: "role-type", label: "Pozisyon türü", earned: max, max, status: "met", detail: "Kıdem seviyesi birebir uyuyor." };
  }

  if (gap === 1) {
    return { key: "role-type", label: "Pozisyon türü", earned: max * 0.6, max, status: "partial", detail: "Kıdem seviyesi bir kademe farklı." };
  }

  return { key: "role-type", label: "Pozisyon türü", earned: 0, max, status: "unmet", detail: "Kıdem seviyesi belirgin şekilde farklı." };
}

function scoreEducation(role: RoleRequirementProfile, candidate: CandidateEligibility): ScoreComponent {
  const max = 10;

  if (!role.education.length) {
    return { key: "education", label: "Eğitim", earned: max * 0.7, max, status: "unknown", detail: "İlanda eğitim şartı belirtilmemiş." };
  }

  if (candidate.educationLevel === null) {
    return { key: "education", label: "Eğitim", earned: max * 0.6, max, status: "unknown", detail: "CV'den eğitim seviyesi okunamadı." };
  }

  const candidateRank = EDUCATION_ORDER[candidate.educationLevel];
  const acceptable = role.education.some((item) => {
    const rank = EDUCATION_ORDER[item.level];
    const statusOk = candidate.isStudent ? item.student : item.graduate || item.student;
    return candidateRank >= rank && statusOk;
  });

  if (acceptable) {
    return { key: "education", label: "Eğitim", earned: max, max, status: "met", detail: "Eğitim şartı karşılanıyor." };
  }

  const levelOk = role.education.some((item) => candidateRank >= EDUCATION_ORDER[item.level]);

  if (levelOk) {
    return { key: "education", label: "Eğitim", earned: max * 0.4, max, status: "partial", detail: "Eğitim seviyesi yeterli ama öğrenci/mezun durumu farklı." };
  }

  return { key: "education", label: "Eğitim", earned: 0, max, status: "unmet", detail: "İlanın istediği eğitim seviyesi karşılanmıyor." };
}

function scoreLocation(role: RoleRequirementProfile, candidate: CandidateEligibility): ScoreComponent {
  const max = 10;

  if (candidate.workMode === "remote" || role.workMode === "remote") {
    return { key: "location", label: "Konum / çalışma modeli", earned: max, max, status: "met", detail: "Uzaktan çalışmaya uygun." };
  }

  if (candidate.locationMode !== "cities" || !candidate.locations.length) {
    return { key: "location", label: "Konum / çalışma modeli", earned: max * 0.8, max, status: "unknown", detail: "Şehir kısıtı seçilmemiş." };
  }

  if (!role.locations.length) {
    return { key: "location", label: "Konum / çalışma modeli", earned: max * 0.6, max, status: "unknown", detail: "İlanın konumu belirtilmemiş." };
  }

  const wanted = candidate.locations.map((city) => normalizeComparable(city));
  const matches = role.locations.some((listing) => {
    const value = normalizeComparable(listing);
    return wanted.some((city) => value.includes(city));
  });

  return matches
    ? { key: "location", label: "Konum / çalışma modeli", earned: max, max, status: "met", detail: `${role.locations[0]} seçtiğin şehirler arasında.` }
    : { key: "location", label: "Konum / çalışma modeli", earned: 0, max, status: "unmet", detail: `İlan ${role.locations[0]} konumunda.` };
}

function scoreLanguage(role: RoleRequirementProfile, candidate: CandidateEligibility): ScoreComponent {
  const max = 5;

  if (!role.languages.length) {
    return { key: "language", label: "Dil ve diğer koşullar", earned: max * 0.8, max, status: "unknown", detail: "İlanda dil şartı belirtilmemiş." };
  }

  const required = role.languages.filter((item) => item.level === "iyi" || item.level === "ileri");

  if (!required.length) {
    return { key: "language", label: "Dil ve diğer koşullar", earned: max, max, status: "met", detail: "Dil şartı temel seviyede." };
  }

  const covered = required.filter((item) => {
    const needle = normalizeComparable(item.language);
    return candidate.languages.some((lang) => lang.includes(needle) || needle.includes(lang));
  });

  if (covered.length === required.length) {
    return { key: "language", label: "Dil ve diğer koşullar", earned: max, max, status: "met", detail: "İstenen diller CV'nde mevcut." };
  }

  if (covered.length > 0) {
    return { key: "language", label: "Dil ve diğer koşullar", earned: max * 0.5, max, status: "partial", detail: "Dillerin bir kısmı karşılanıyor." };
  }

  return { key: "language", label: "Dil ve diğer koşullar", earned: 0, max, status: "unmet", detail: `İlan ${required[0].language} istiyor.` };
}

// ─── Katman 3: Teknik uyum (40 puan) ──────────────────────────────────────

/** Bir şart listesinde adayın becerilerinden kaçının geçtiğini ölçer. */
function coverage(lines: string[], skills: string[]): { ratio: number; matched: string[] } {
  if (!lines.length || !skills.length) {
    return { ratio: 0, matched: [] };
  }

  const haystack = normalizeComparable(lines.join(" "));
  const matched = skills.filter((skill) => skill.length >= 2 && haystack.includes(skill));

  // Oran, ilanın şart sayısına değil adayın eşleşen beceri sayısına göre
  // ölçeklenir: uzun ilan metni adayı cezalandırmamalı.
  const denominator = Math.max(3, Math.min(skills.length, 10));
  return { ratio: Math.min(1, matched.length / denominator), matched };
}

function scoreTechnical(
  role: RoleRequirementProfile,
  candidate: CandidateEligibility,
  listingKeywords: string[]
): { components: ScoreComponent[]; requiredCoverage: number } {
  const requiredCov = coverage(role.requiredSkills, candidate.skills);
  const preferredCov = coverage(role.preferredSkills, candidate.skills);
  const keywordCov = coverage([...role.requiredSkills, ...role.preferredSkills], candidate.keywords);
  const listingKeywordCov = coverage(listingKeywords, candidate.skills);

  /**
   * "Bilinmiyor" ile "karşılanmadı" ayrımı Katman 3'te de geçerlidir.
   *
   * İlan "tercih edilen beceriler" bölümü yazmamışsa aday o bölümden 0 almamalı:
   * bu, ilanın yazım biçimini adayın eksiği gibi göstermek olur. Ölçümde bu hata
   * birebir görüldü — zorunlu becerilerin tamamını karşılayan aday, ilanda
   * "tercihen" maddesi bulunmadığı için 40 üzerinden 21,7 alıyordu.
   */
  const buildComponent = (
    key: string,
    label: string,
    max: number,
    cov: { ratio: number; matched: string[] },
    hasSource: boolean,
    metDetail: (matched: string[]) => string,
    unmetDetail: string,
    unknownDetail: string
  ): ScoreComponent => {
    if (!hasSource) {
      return { key, label, earned: max * 0.7, max, status: "unknown", detail: unknownDetail };
    }

    return {
      key,
      label,
      earned: max * cov.ratio,
      max,
      status: cov.ratio >= 0.6 ? "met" : cov.ratio > 0 ? "partial" : "unmet",
      detail: cov.matched.length ? metDetail(cov.matched) : unmetDetail
    };
  };

  const components: ScoreComponent[] = [
    buildComponent(
      "required-skills",
      "Zorunlu beceriler",
      15,
      requiredCov,
      role.requiredSkills.length > 0,
      (matched) => `Eşleşen: ${matched.slice(0, 5).join(", ")}`,
      "İlanın zorunlu becerileriyle eşleşme bulunamadı.",
      "İlanda zorunlu beceri listelenmemiş."
    ),
    buildComponent(
      "preferred-skills",
      "Tercih edilen beceriler",
      10,
      preferredCov,
      role.preferredSkills.length > 0,
      (matched) => `Eşleşen: ${matched.slice(0, 4).join(", ")}`,
      "Tercih edilen becerilerde eşleşme yok.",
      "İlanda tercih edilen beceri belirtilmemiş."
    ),
    buildComponent(
      "experience-relation",
      "Deneyim ilişkisi",
      10,
      keywordCov,
      role.requiredSkills.length + role.preferredSkills.length > 0,
      (matched) => `İlgili alanlar: ${matched.slice(0, 4).join(", ")}`,
      "Deneyim alanların ilanla doğrudan örtüşmüyor.",
      "İlan metninden şart çıkarılamadı."
    ),
    buildComponent(
      "listing-keywords",
      "İlan anahtar kelimeleri",
      5,
      listingKeywordCov,
      listingKeywords.length > 0,
      (matched) => `${matched.length} anahtar kelime eşleşti.`,
      "Anahtar kelime eşleşmesi yok.",
      "İlanın anahtar kelimeleri okunamadı."
    )
  ];

  return { components, requiredCoverage: requiredCov.ratio };
}

// ─── Bileşim ──────────────────────────────────────────────────────────────

export function scoreBand(total: number): EligibilityBand {
  if (total >= 90) return "cok-guclu";
  if (total >= 80) return "cok-uygun";
  if (total >= 70) return "uygun";
  if (total >= 60) return "sinirda";
  return "uygun-degil";
}

export const BAND_LABELS: Record<EligibilityBand, string> = {
  "cok-guclu": "Çok güçlü",
  "cok-uygun": "Çok uygun",
  uygun: "Uygun",
  sinirda: "Sınırda",
  "uygun-degil": "Uygun değil"
};

export type EvaluateOptions = {
  /** Katman 0 — ilan doğrulanmış ve aktif mi? */
  listingVerified?: boolean;
  /** İlanın kendi anahtar kelimeleri (başlık, eşleşen kelimeler). */
  listingKeywords?: string[];
};

export function evaluateEligibility(
  role: RoleRequirementProfile,
  candidate: CandidateEligibility,
  options: EvaluateOptions = {}
): EligibilityResult {
  const roleComponents = [
    scoreExperience(role, candidate),
    scoreRoleType(role, candidate),
    scoreEducation(role, candidate),
    scoreLocation(role, candidate),
    scoreLanguage(role, candidate)
  ];

  const { components: technicalComponents, requiredCoverage } = scoreTechnical(
    role,
    candidate,
    options.listingKeywords ?? []
  );

  const blockers: HardBlocker[] = [];

  // Katman 0 — ilan geçerliliği her şeyin önünde gelir.
  if (options.listingVerified === false) {
    blockers.push({
      code: "listing-invalid",
      label: "İlan doğrulanamadı",
      detail: "İlan yayından kalkmış veya sayfası açılamıyor."
    });
  }

  blockers.push(...findHardBlockers(role, candidate));

  const roleScore = roleComponents.reduce((sum, item) => sum + item.earned, 0);
  const technicalScore = technicalComponents.reduce((sum, item) => sum + item.earned, 0);
  const totalScore = Math.round(roleScore + technicalScore);

  return {
    eligible: blockers.length === 0,
    blockers,
    roleScore: Math.round(roleScore * 10) / 10,
    technicalScore: Math.round(technicalScore * 10) / 10,
    totalScore,
    band: scoreBand(totalScore),
    roleComponents,
    technicalComponents,
    requiredCoverage,
    requirementConfidence: role.extractedFields >= 3 ? "high" : role.extractedFields >= 1 ? "medium" : "low"
  };
}

/**
 * §14 — Sıralama. Yalnızca yüzdelik skora göre sıralamak yetmez; öncelik
 * sırası uygunluk → kıdem → zorunlu şart kapsama → pozisyon → teknik → güncellik
 * şeklindedir.
 */
export function compareByPriority(
  left: { eligibility: EligibilityResult; postedAt?: string },
  right: { eligibility: EligibilityResult; postedAt?: string }
): number {
  // 1. Hard eligibility
  if (left.eligibility.eligible !== right.eligibility.eligible) {
    return left.eligibility.eligible ? -1 : 1;
  }

  // 2-3. Pozisyon uygunluğu ve zorunlu şart kapsaması
  if (Math.abs(left.eligibility.roleScore - right.eligibility.roleScore) >= 5) {
    return right.eligibility.roleScore - left.eligibility.roleScore;
  }

  if (Math.abs(left.eligibility.requiredCoverage - right.eligibility.requiredCoverage) >= 0.15) {
    return right.eligibility.requiredCoverage - left.eligibility.requiredCoverage;
  }

  // 4-5. Toplam ve teknik uyum
  if (left.eligibility.totalScore !== right.eligibility.totalScore) {
    return right.eligibility.totalScore - left.eligibility.totalScore;
  }

  // 6. İlan güncelliği
  const leftDate = left.postedAt ? Date.parse(left.postedAt) : 0;
  const rightDate = right.postedAt ? Date.parse(right.postedAt) : 0;
  return rightDate - leftDate;
}
