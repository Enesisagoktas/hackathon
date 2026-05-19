import {
  getWorkModeDisplay,
  normalizeCities,
  normalizeLocationMode,
  normalizeWorkMode,
  type LocationMode,
  type WorkMode
} from "@/lib/search-preferences";
import { crawlJobs } from "@/lib/jobs/crawler";
import { scoreListingsWithAi } from "@/lib/jobs/score";
import type {
  AiCvProfile,
  CandidateProfile,
  JobPlatform,
  JobResultCategory,
  JobResultConfidence,
  JobSearchResponse,
  JobSearchResult,
  JobSearchSummary,
  SearchJobsInput
} from "@/lib/jobs/types";

export type {
  CriteriaItem,
  CriteriaMatchResult,
  JobPlatform,
  JobResultCategory,
  JobResultConfidence,
  JobResultKind,
  JobSearchResponse,
  JobSearchResult,
  JobSearchSummary,
  PlatformCrawlStatus,
  SearchJobsInput
} from "@/lib/jobs/types";

type PlatformConfig = {
  platform: JobPlatform;
  category: JobResultCategory;
  description: string;
  scoreBoost: number;
  directSearch: boolean;
  buildUrl: (query: string) => string;
};

type QueryPlan = {
  query: string;
  title: string;
  baseScore: number;
  category: JobResultCategory;
  focus: "role" | "skill" | "location" | "tech";
};

const DEFAULT_LOCATION = "Türkiye";
const MAX_PRIMARY_SKILLS = 4;
const MAX_RESULTS = 14;

const PLATFORM_CONFIGS: PlatformConfig[] = [
  {
    platform: "Kariyer.net",
    category: "general",
    description: "Kurumsal ve beyaz yaka ilanlarda en geniş Türk platformlarından biri.",
    scoreBoost: 8,
    directSearch: true,
    buildUrl: (query) => `https://www.kariyer.net/is-ilanlari/${slugify(query)}`
  },
  {
    platform: "Secretcv",
    category: "general",
    description: "Kurumsal şirketler ve orta seviye uzman roller için tamamlayıcı kaynak.",
    scoreBoost: 5,
    directSearch: true,
    buildUrl: (query) => `https://www.secretcv.com/is-ilanlari/${slugify(query)}-is-ilanlari`
  },
  {
    platform: "Eleman.net",
    category: "general",
    description: "Operasyon, satış, saha, teknik ve mavi yaka rollerinde güçlü genel platform.",
    scoreBoost: 4,
    directSearch: true,
    buildUrl: (query) => `https://www.eleman.net/is-ilanlari/${slugify(query)}`
  },
  {
    platform: "Yenibiriş",
    category: "general",
    description: "Kariyer.net dışındaki genel ilan havuzunu kontrol etmek için iyi tamamlayıcı kaynak.",
    scoreBoost: 2,
    directSearch: true,
    buildUrl: (query) => `https://www.yenibiris.com/is-ilanlari?kelime=${encodeURIComponent(query)}`
  },
  {
    platform: "Toptalent",
    category: "tech",
    description: "Teknoloji, ürün, finans, danışmanlık ve nitelikli aday rollerine odaklanır.",
    scoreBoost: 3,
    directSearch: true,
    buildUrl: (query) => `https://toptalent.co/is-ilanlari/${slugify(query)}-is-ilanlari`
  },
  {
    platform: "LinkedIn",
    category: "general",
    description: "Dünya genelinde en büyük profesyonel ağ. Türkiye'deki kurumsal ve çok uluslu şirket ilanlarına erişim sağlar.",
    scoreBoost: 4,
    directSearch: true,
    buildUrl: (query) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=Turkey&f_TPR=r604800`
  },
  {
    platform: "İŞKUR",
    category: "public",
    description: "Kamu destekli açık iş ilanları ekranı. Güvenilir sorgu parametresi olmadığı için tek yönlendirme verilir.",
    scoreBoost: -8,
    directSearch: false,
    buildUrl: () => "https://esube.iskur.gov.tr/istihdam/AcikIsIlanAra.aspx"
  }
];

export function generateJobSearchResults(input: SearchJobsInput): JobSearchResponse {
  const skills = cleanTerms(input.skills ?? []).slice(0, 8);
  const titles = cleanTerms(input.titles ?? []).slice(0, 4);
  const locationMode = normalizeLocationMode(input.locationMode);
  const cities = normalizeCities(input.cities);
  const workMode = normalizeWorkMode(input.workMode);
  const legacyLocation = sanitizeTerm(input.location ?? "");
  const locations = buildLocations(locationMode, cities, legacyLocation);
  const targetRole = titles[0] ?? "Genel Uzman";
  const primarySkills = skills.slice(0, MAX_PRIMARY_SKILLS);
  const queryPlans = buildQueryPlans({ targetRole, titles, skills: primarySkills, locations, locationMode, workMode });
  const isTech = isTechProfile(skills, titles);
  const results = uniqueResults(
    queryPlans.flatMap((plan, index) =>
      selectPlatforms(plan, index, isTech).map((platform) => createSearchResult(platform, plan, {
        targetRole,
        primarySkills,
        locations,
        locationMode,
        workMode
      }))
    )
  )
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, MAX_RESULTS)
    .map((result, index) => ({ ...result, id: `${result.id}-${index + 1}` }));

  return {
    results,
    summary: {
      targetRole,
      primarySkills,
      locations,
      workMode: getWorkModeDisplay(workMode),
      resultCount: results.length,
      sourceNote:
        "Bu sonuçlar sadece yedek platform arama rotalarıdır. Ana iş akışı gerçek ilan detay linklerini crawler ile toplamayı dener."
    }
  };
}

export async function searchJobListings(input: SearchJobsInput): Promise<JobSearchResponse> {
  const fallback = generateJobSearchResults(input);
  const profile = buildCandidateProfile(input, fallback.summary.targetRole);

  try {
    const crawlResult = await crawlJobs(profile);

    // AI scoring using Gemini
    let realResults: JobSearchResult[] = [];
    if (crawlResult.listings.length > 0) {
      realResults = await scoreListingsWithAi(crawlResult.listings, profile);
    }

    // Apply hard filters for location and work mode
    const filteredResults = applyHardFilters(realResults, profile);

    const parsedCount = crawlResult.statuses.reduce((sum, status) => sum + status.parsedListings, 0);
    const discoveredCount = crawlResult.statuses.reduce((sum, status) => sum + status.discoveredUrls, 0);

    const errorType = determineErrorType(crawlResult.statuses, filteredResults.length, discoveredCount, parsedCount);

    return {
      results: filteredResults,
      fallbackResults: fallback.results.slice(0, 6),
      summary: {
        ...fallback.summary,
        primarySkills: profile.skills.slice(0, MAX_PRIMARY_SKILLS),
        locations: profile.locations,
        resultCount: filteredResults.length,
        realJobCount: filteredResults.length,
        fallbackCount: fallback.results.length,
        crawlStatuses: crawlResult.statuses,
        errorType,
        sourceNote: buildSourceNote(filteredResults.length, parsedCount, discoveredCount, errorType)
      }
    };
  } catch (error) {
    return {
      results: [],
      fallbackResults: fallback.results.slice(0, 6),
      summary: {
        ...fallback.summary,
        resultCount: 0,
        realJobCount: 0,
        fallbackCount: fallback.results.length,
        errorType: "crawler_failed",
        sourceNote:
          error instanceof Error
            ? `Crawler çalışırken hata oluştu: ${error.message}. Yedek arama linkleri aşağıda sunuldu.`
            : "Crawler çalışırken hata oluştu. Yedek arama linkleri aşağıda sunuldu."
      }
    };
  }
}

/** Apply hard filters: location and work mode are NOT just bonuses, they eliminate */
function applyHardFilters(results: JobSearchResult[], profile: CandidateProfile): JobSearchResult[] {
  return results.filter((result) => {
    // Location hard filter: if user selected specific cities, exclude non-matching
    if (profile.locationMode === "cities" && profile.locations.length > 0 && result.location) {
      const locationText = result.location.toLocaleLowerCase("tr-TR");
      const hasMatch = profile.locations.some((city) =>
        locationText.includes(city.toLocaleLowerCase("tr-TR"))
      );
      // Allow if location matches OR if result has no clear location (might be remote)
      if (!hasMatch && locationText.length > 3) {
        // Check if it might be remote
        if (result.workMode && /uzaktan|remote/i.test(result.workMode)) {
          // Remote jobs pass location filter
        } else {
          return false;
        }
      }
    }

    // Work mode hard filter
    if (profile.workMode === "remote" && result.workMode) {
      const mode = result.workMode.toLocaleLowerCase("tr-TR");
      if (/ofisten|onsite|yerinde/i.test(mode) && !/uzaktan|remote|hibrit|hybrid/i.test(mode)) {
        return false;
      }
    }

    if (profile.workMode === "onsite" && result.workMode) {
      const mode = result.workMode.toLocaleLowerCase("tr-TR");
      if (/uzaktan|remote/i.test(mode) && !/ofis|onsite|hibrit|hybrid/i.test(mode)) {
        return false;
      }
    }

    return true;
  });
}

function determineErrorType(
  statuses: { status: string; parsedListings: number; discoveredUrls: number; message?: string }[],
  resultCount: number,
  discoveredCount: number,
  parsedCount: number
): "no_match" | "crawler_failed" | "parser_error" | "query_issue" | "none" {
  if (resultCount > 0) return "none";
  
  const allFailed = statuses.every((s) => s.status === "failed");
  if (allFailed) return "crawler_failed";
  
  if (parsedCount > 0 && resultCount === 0) return "no_match";
  if (discoveredCount > 0 && parsedCount === 0) return "parser_error";
  if (discoveredCount === 0) return "query_issue";
  
  return "no_match";
}

function buildSourceNote(resultCount: number, parsedCount: number, discoveredCount: number, errorType: string): string {
  if (resultCount > 0) {
    return `${discoveredCount} gerçek ilan linki keşfedildi, ${parsedCount} ilan detayı parse edildi ve ${resultCount} ilan CV uyumuna göre AI ile sıralandı.`;
  }

  switch (errorType) {
    case "crawler_failed":
      return "Platformlara erişim sağlanamadı. Siteler geçici olarak erişilemez olabilir veya anti-bot koruması devreye girmiş olabilir. Yedek arama linkleri aşağıda sunuldu.";
    case "parser_error":
      return `${discoveredCount} ilan linki keşfedildi ancak detay sayfaları parse edilemedi. Site yapısı değişmiş olabilir. Yedek arama linkleri aşağıda sunuldu.`;
    case "query_issue":
      return "Arama sorguları sonuç üretemedi. CV'deki profil için daha geniş arama terimleri denenebilir. Yedek arama linkleri aşağıda sunuldu.";
    case "no_match":
      return `${parsedCount} ilan parse edildi ancak CV profilinizle yeterli uyum sağlanamadı. Yedek arama linkleri aşağıda sunuldu.`;
    default:
      return "Sonuç bulunamadı. Yedek arama linkleri aşağıda sunuldu.";
  }
}

function buildCandidateProfile(input: SearchJobsInput, fallbackTargetRole: string): CandidateProfile {
  const skills = cleanTerms(input.skills ?? []).slice(0, 12);
  const titles = cleanTerms(input.titles ?? []).slice(0, 6);
  const languages = cleanTerms(input.languages ?? []).slice(0, 6);
  const experienceAreas = cleanTerms(input.experienceAreas ?? []).slice(0, 8);
  const industries = cleanTerms(input.industries ?? []).slice(0, 8);
  const searchKeywords = cleanTerms(input.searchKeywords ?? []).slice(0, 30);
  const locationMode = normalizeLocationMode(input.locationMode);
  const cities = normalizeCities(input.cities);
  const workMode = normalizeWorkMode(input.workMode);
  const legacyLocation = sanitizeTerm(input.location ?? "");
  const locations = buildLocations(locationMode, cities, legacyLocation);
  const ai = input.aiProfile;

  // Use AI-detected target positions if available
  const aiTitles = cleanTerms(ai?.targetPositions ?? []);
  const allTitles = unique([...titles, ...aiTitles]).slice(0, 8);
  const targetRole = allTitles[0] ?? inferTitleForSearch([...skills, ...searchKeywords]) ?? fallbackTargetRole;

  // Merge AI query variations with standard keywords
  const aiQueryVariations = cleanTerms(ai?.queryVariations ?? []);
  const keywords = unique([
    ...searchKeywords,
    ...skills,
    ...allTitles,
    ...industries,
    ...experienceAreas,
    ...languages,
    ...aiQueryVariations
  ]).slice(0, 60);

  return {
    targetRole,
    titles: unique([targetRole, ...allTitles]).slice(0, 8),
    skills,
    languages,
    industries,
    experienceAreas,
    keywords,
    locations,
    locationMode,
    workMode,
    fullText: input.fullText,
    cvSummary: ai?.cvSummary,
    queryVariations: aiQueryVariations,
    seniority: ai?.seniority,
    yearsOfExperience: ai?.yearsOfExperience,
    targetPositions: ai?.targetPositions,
    certifications: ai?.certifications,
    educationLevel: ai?.educationLevel,
    preferredRoles: ai?.preferredRoles,
    professionCategory: ai?.professionCategory
  };
}

function buildQueryPlans({
  targetRole,
  titles,
  skills,
  locations,
  locationMode,
  workMode
}: {
  targetRole: string;
  titles: string[];
  skills: string[];
  locations: string[];
  locationMode: LocationMode;
  workMode: WorkMode;
}) {
  const plans: QueryPlan[] = [];
  const workTerm = getCompactWorkTerm(workMode);
  const primarySkill = skills[0];
  const secondarySkill = skills[1];
  const primaryLocation = locationMode === "cities" ? locations[0] : undefined;

  plans.push({
    query: joinQuery([targetRole, primarySkill, secondarySkill, workTerm]),
    title: `${targetRole} odaklı ana arama`,
    baseScore: 88,
    category: "recommended",
    focus: "role"
  });

  plans.push({
    query: joinQuery([targetRole, primarySkill]),
    title: `${targetRole} rol eşleşmesi`,
    baseScore: 82,
    category: "recommended",
    focus: "skill"
  });

  if (primaryLocation) {
    plans.push({
      query: joinQuery([targetRole, primaryLocation]),
      title: `${primaryLocation} lokasyon araması`,
      baseScore: 78,
      category: "general",
      focus: "location"
    });
  }

  const alternativeTitle = titles.find((title) => title !== targetRole);
  if (alternativeTitle) {
    plans.push({
      query: joinQuery([alternativeTitle, primarySkill]),
      title: `${alternativeTitle} alternatif rol`,
      baseScore: 76,
      category: "general",
      focus: "role"
    });
  }

  if (isTechProfile(skills, titles)) {
    plans.push({
      query: joinQuery([targetRole, primarySkill ?? "technology"]),
      title: "Teknoloji ve startup araması",
      baseScore: 74,
      category: "tech",
      focus: "tech"
    });
  }

  return uniqueQueryPlans(plans).slice(0, 5);
}

function selectPlatforms(plan: QueryPlan, index: number, isTech: boolean) {
  const platforms = PLATFORM_CONFIGS.filter((config) => {
    if (config.category === "public") {
      return index === 0;
    }

    if (config.platform === "LinkedIn") {
      return index <= 1; // Include LinkedIn in first 2 query plans
    }

    if (config.platform === "Toptalent") {
      return isTech || index === 0;
    }

    if (index >= 2 && config.platform === "Yenibiriş") {
      return false;
    }

    return config.category === "general" || plan.category === config.category || plan.category === "recommended";
  });

  return platforms.slice(0, index === 0 ? 7 : 4);
}

function createSearchResult(
  platform: PlatformConfig,
  plan: QueryPlan,
  context: {
    targetRole: string;
    primarySkills: string[];
    locations: string[];
    locationMode: LocationMode;
    workMode: WorkMode;
  }
): JobSearchResult {
  const score = clamp(
    plan.baseScore +
      platform.scoreBoost +
      (context.primarySkills.length >= 2 ? 3 : 0) +
      (context.locationMode === "cities" ? 2 : 0) +
      (context.workMode !== "any" ? 2 : 0),
    45,
    98
  );
  const confidence = getConfidence(score, platform.directSearch);
  const category = plan.category === "recommended" ? "recommended" : platform.category;

  return {
    id: slugify(`${platform.platform}-${plan.query}`),
    kind: "search",
    platform: platform.platform,
    category,
    title: plan.title,
    location: context.locations.join(", "),
    workMode: getWorkModeDisplay(context.workMode),
    query: plan.query,
    description: platform.description,
    url: platform.buildUrl(plan.query),
    matchScore: score,
    matchReasons: buildMatchReasons(platform, plan, context),
    confidence,
    actionLabel: platform.directSearch ? "Platformda ara" : "Arama ekranını aç"
  };
}

function buildMatchReasons(
  platform: PlatformConfig,
  plan: QueryPlan,
  context: {
    targetRole: string;
    primarySkills: string[];
    locations: string[];
    locationMode: LocationMode;
    workMode: WorkMode;
  }
) {
  const reasons = [
    `${context.targetRole} hedef rolü aramanın merkezinde.`,
    context.primarySkills.length
      ? `${context.primarySkills.slice(0, 3).join(", ")} becerileri eşleşme sinyali olarak kullanıldı.`
      : "CV'deki pozisyon sinyali beceri sinyali yerine kullanıldı."
  ];

  if (context.locationMode === "cities") {
    reasons.push(`Lokasyon tercihi: ${context.locations.slice(0, 3).join(", ")}.`);
  }

  if (context.workMode !== "any") {
    reasons.push(`Çalışma modeli tercihi: ${getWorkModeDisplay(context.workMode)}.`);
  }

  if (plan.focus === "tech") {
    reasons.push("Teknoloji/startup platformlarında daha niş ilan yakalama ihtimali var.");
  }

  if (!platform.directSearch) {
    reasons.push("Bu kaynakta güvenilir sorgu URL'i olmadığı için tek güvenli arama ekranı açılır.");
  }

  return reasons.slice(0, 5);
}

function buildLocations(locationMode: LocationMode, cities: string[], legacyLocation: string) {
  if (locationMode === "cities" && cities.length) {
    return cities.slice(0, 5);
  }

  if (legacyLocation && legacyLocation !== DEFAULT_LOCATION) {
    return [legacyLocation];
  }

  return ["Tüm Türkiye"];
}

function inferTitleForSearch(skills: string[]) {
  const skillText = skills.join(" ").toLocaleLowerCase("tr-TR");

  if (/react|next|vue|angular|html|css|tailwind|figma|ui\/ux/.test(skillText)) {
    return "Frontend Developer";
  }

  if (/node|express|nestjs|java|spring|postgres|mongodb|sql|\.net|php|laravel/.test(skillText)) {
    return "Backend Developer";
  }

  if (/flutter|react native|android|ios/.test(skillText)) {
    return "Mobile Developer";
  }

  if (/docker|kubernetes|aws|azure|devops/.test(skillText)) {
    return "DevOps Engineer";
  }

  if (/python|data|sql|power bi|tableau/.test(skillText)) {
    return "Data Analyst";
  }

  if (/export|ihracat|dış ticaret|international|pazarlama|marketing/.test(skillText)) {
    return "Export Marketing Specialist";
  }

  if (/satış|sales|business development/.test(skillText)) {
    return "Sales Specialist";
  }

  return undefined;
}

function isTechProfile(skills: string[], titles: string[]) {
  const text = [...skills, ...titles].join(" ").toLocaleLowerCase("tr-TR");
  return /developer|engineer|software|frontend|backend|full stack|data|devops|qa|react|node|python|java|sql|ui\/ux|product/.test(text);
}

function getCompactWorkTerm(workMode: WorkMode) {
  if (workMode === "remote") {
    return "remote";
  }

  if (workMode === "hybrid") {
    return "hibrit";
  }

  return undefined;
}

function cleanTerms(terms: string[]) {
  return unique(terms.map(sanitizeTerm).filter(Boolean));
}

function sanitizeTerm(term: string) {
  return term.replace(/[<>"'`]/g, "").replace(/\s+/g, " ").trim();
}

function joinQuery(parts: Array<string | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join(" ");
}

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function uniqueQueryPlans(plans: QueryPlan[]) {
  const seen = new Set<string>();
  return plans.filter((plan) => {
    const key = plan.query.toLocaleLowerCase("tr-TR");

    if (!plan.query || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function uniqueResults(results: JobSearchResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = normalizeUrl(result.url);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizeUrl(url: string) {
  return url.replace(/\/+$/, "").toLocaleLowerCase("tr-TR");
}

function getConfidence(score: number, directSearch: boolean): JobResultConfidence {
  if (!directSearch) {
    return "low";
  }

  if (score >= 86) {
    return "high";
  }

  return "medium";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function slugify(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
