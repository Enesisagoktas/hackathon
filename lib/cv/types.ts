/**
 * CV uyarlama katmanının veri tipleri.
 *
 * Temel kural: `TailoredCv` içindeki her satır `StructuredCv` içindeki bir
 * kanıta dayanmak zorundadır. İlan bir beceri istiyor ama CV'de karşılığı
 * yoksa o beceri CV'ye YAZILMAZ; `GapItem` olarak rapora düşer.
 */

export type ContactInfo = {
  fullName: string;
  email?: string;
  phone?: string;
  location?: string;
  /** LinkedIn, GitHub, portfolyo vb. */
  links: string[];
};

export type ExperienceEntry = {
  role: string;
  company?: string;
  period?: string;
  location?: string;
  /** CV'de geçen görev/başarı satırları. */
  bullets: string[];
  /** Bu deneyimde fiilen kullanılan beceriler. */
  skills: string[];
};

export type EducationEntry = {
  degree: string;
  school?: string;
  period?: string;
  detail?: string;
};

export type LanguageEntry = {
  name: string;
  level?: string;
};

export type ProjectEntry = {
  name: string;
  detail?: string;
  skills: string[];
};

/** Ham CV metninden çıkarılan yapılandırılmış ana CV. Tek gerçek kaynağı budur. */
export type StructuredCv = {
  contact: ContactInfo;
  headline?: string;
  summary?: string;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  skills: string[];
  certifications: string[];
  languages: LanguageEntry[];
  projects: ProjectEntry[];
  /** Yukarıdaki bölümlere girmeyen ama kaybolmaması gereken satırlar. */
  extras: string[];
  source: "ai" | "heuristic";
};

/** İlanın istediği ama CV'de kanıtı olmayan gereksinim. Asla CV'ye yazılmaz. */
export type GapItem = {
  requirement: string;
  /** Neden eksik sayıldığı ve kullanıcının ne yapabileceği. */
  note: string;
  severity: "critical" | "nice-to-have";
};

/** İlan terimlerinin CV'de karşılanma durumu (ATS uyumu için). */
export type KeywordAlignmentItem = {
  term: string;
  status: "covered" | "partial" | "missing";
  /** `covered`/`partial` ise CV'deki dayanak. */
  evidence?: string;
};

export type TailoredSkillGroup = {
  title: string;
  skills: string[];
};

/**
 * İlana göre yeniden kurgulanmış CV. Render katmanı (PDF/DOCX/HTML) yalnızca
 * bu nesneyi okur.
 */
export type TailoredCv = {
  contact: ContactInfo;
  /** İlanın unvanına hizalanmış başlık, ör. "Frontend Developer". */
  headline: string;
  /** İlana göre yeniden yazılmış 2-4 cümlelik profesyonel özet. */
  summary: string;
  /** İlanın istediği VE CV'de kanıtı olan beceriler — en üstte gösterilir. */
  highlightedSkills: string[];
  /** İlanda geçmeyen ama işverenin ilgisini çekebilecek gerçek beceriler. */
  adjacentSkills: string[];
  /** Kalan beceriler, kategorilere ayrılmış. */
  skillGroups: TailoredSkillGroup[];
  /** İlana göre yeniden sıralanmış ve dili hizalanmış deneyim. */
  experience: ExperienceEntry[];
  education: EducationEntry[];
  certifications: string[];
  languages: LanguageEntry[];
  projects: ProjectEntry[];
  source: "ai" | "heuristic";
};

export type TailoringResult = {
  tailoredCv: TailoredCv;
  coverLetter: string;
  emailSubject: string;
  gaps: GapItem[];
  keywordAlignment: KeywordAlignmentItem[];
  /** Neyin neden değiştirildiği — kullanıcıya şeffaflık için gösterilir. */
  changeNotes: string[];
  source: "ai" | "heuristic";
};

/** Uyarlama girdisi olarak kullanılan ilan özeti. */
export type TailoringListing = {
  title: string;
  company?: string;
  location?: string;
  platform?: string;
  workMode?: string;
  description: string;
  requirements: string[];
  candidateCriteria: string[];
  url: string;
};
