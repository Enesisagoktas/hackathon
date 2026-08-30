import {
  getWorkModeDisplay,
  normalizeCities,
  normalizeLocationMode,
  normalizeWorkMode,
  type LocationMode,
  type WorkMode
} from "@/lib/search-preferences";
import { dedupeListings } from "@/lib/jobs/dedupe";
import { searchCachedListings } from "@/lib/jobs/search-cache";
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

export type SearchJobListingsOptions = {
  /**
   * Cache yeterli aday üretemezse canlı crawler'ı devreye sokar.
   * Yalnızca worker akışında açılır: HTTP isteği içinde dakikalarca süren
   * tarama çalıştırmak zaman aşımına yol açar.
   */
  allowLiveCrawl?: boolean;
  /**
   * §7/§22 — Arama aşama aşama ilerlediğini bildirir.
   *
   * Worker bunu veritabanına yazıp arayüze taşır. Çağrı hata verirse arama
   * durmaz: ilerleme bildirimi bir kolaylıktır, işin kendisi değildir.
   */
  onStage?: (
    key: "plan" | "primary-search" | "alternative-search" | "boutique-search" | "verify" | "match" | "rank",
    status: "running" | "done" | "skipped",
    detail?: string,
    counters?: { found?: number; verified?: number; eliminated?: number; eligible?: number }
  ) => void | Promise<void>;
};

// AI skorlaması bu sayının altında ALAKALI ilan bulursa canlı tarama devreye girer.
const LIVE_CRAWL_MIN_RESULTS = Number(process.env.LIVE_CRAWL_MIN_RESULTS ?? 5);

/**
 * Arama notundaki dolgu kelimeler. Bunlar hiçbir ilanı ayırt etmez ama
 * anahtar kelime listesinde yer kaplayıp gerçek sinyalleri (beceri, sektör)
 * geri iter.
 */
const NOTE_STOPWORDS = new Set([
  "istiyorum", "isterim", "istemiyorum", "lütfen", "olsun", "olsun.", "tercih",
  "ederim", "çalışmak", "çalışabilirim", "çalışırım", "yakınında", "civarında",
  "öncelikli", "öncelik", "ağırlıklı", "şirketleri", "şirket", "firma",
  "firmalar", "pozisyon", "pozisyonlar", "pozisyonlara", "olabilir", "gerek",
  "gerekiyor", "mümkün", "bence", "ayrıca", "özellikle", "biraz", "sadece",
  "yapabilirim", "yapmak", "arıyorum", "bakıyorum", "değil", "daha", "kadar",
  "için", "veya", "hem", "diye", "gibi"
]);

/**
 * Cache-first job matching: önce DB cache'inden aday toplar, AI ile skorlar.
 * `allowLiveCrawl` açıksa ve cache hedef role dair yeterli aday veremiyorsa
 * (ör. hemşire CV'sine karşılık cache'te sadece yazılım ilanı varsa) canlı
 * crawler çalıştırılır, bulunan güncel ilanlar cache'e yazılır ve arama
 * tazelenmiş cache üzerinden tekrarlanır.
 */
export async function searchJobListings(
  input: SearchJobsInput,
  options: SearchJobListingsOptions = {}
): Promise<JobSearchResponse> {
  const profile = buildCandidateProfile(input, "Genel aday profili");
  const baseSummary: JobSearchSummary = {
    targetRole: profile.targetRole,
    primarySkills: profile.skills.slice(0, MAX_PRIMARY_SKILLS),
    locations: profile.locations,
    workMode: getWorkModeDisplay(profile.workMode),
    resultCount: 0,
    realJobCount: 0,
    fallbackCount: 0,
    sourceNote: ""
  };

  // Aşama bildirimi aramayı asla düşürmemeli.
  const stage: NonNullable<SearchJobListingsOptions["onStage"]> = async (key, status, detail, counters) => {
    try {
      await options.onStage?.(key, status, detail, counters);
    } catch (error) {
      console.warn("[search] Aşama bildirimi başarısız:", error instanceof Error ? error.message : error);
    }
  };

  try {
    await stage("plan", "done", `"${profile.targetRole}" için arama planı hazır`);

    // 1. Tur: cache'teki adaylar AI ile skorlanır.
    await stage("primary-search", "running", "Veritabanı cache'i taranıyor");
    const candidates = await searchCachedListings(profile);
    const firstRound = candidates.length
      ? await scoreListingsWithAi(candidates, profile)
      : { results: [] as JobSearchResult[], evaluatedUrls: new Set<string>() };

    let results = sortResults(firstRound.results);
    let liveCrawlNote = "";
    let totalCandidates = candidates.length;

    await stage(
      "primary-search",
      "done",
      `${candidates.length} aday değerlendirildi, ${results.length} uygun ilan bulundu`,
      { found: candidates.length, eligible: results.length }
    );

    // 2. Tur: ALAKALI sonuç azsa canlı tarama.
    //
    // Tetik bilinçli olarak aday sayısına değil SONUÇ sayısına bakar: cache,
    // "İngilizce" gibi genel kelimelerle alakasız adaylar döndürebilir; AI
    // bunların hepsini eler ve elde 0 ilan kalır. Ölçülen gerçek ihtiyaç
    // "kaç aday bulundu" değil "kaç uygun ilan çıktı"dır.
    if (options.allowLiveCrawl && results.length < LIVE_CRAWL_MIN_RESULTS) {
      await stage("alternative-search", "running", "Kaynaklar dalga dalga taranıyor");
      liveCrawlNote = await runLiveCrawl(profile, (key, status, detail) => stage(key, status, detail));
      await stage("alternative-search", "done", liveCrawlNote.trim() || "Canlı tarama tamamlandı");

      // Tekrar skorlanmayacaklar YALNIZCA AI'nın fiilen karar verdikleridir.
      // Burada tüm 1. tur adaylarını elemek hatalı olur: batch'i çöktüğü için
      // hiç değerlendirilememiş ilanlar kalıcı olarak listeden düşerdi.
      const refreshed = await searchCachedListings(profile);
      const pending = refreshed.filter((candidate) => !firstRound.evaluatedUrls.has(candidate.url));
      totalCandidates = candidates.length + pending.filter((candidate) => !candidates.some((c) => c.url === candidate.url)).length;

      if (pending.length) {
        await stage("boutique-search", "running", `${pending.length} yeni ilan değerlendiriliyor`);
        const secondRound = await scoreListingsWithAi(pending, profile);
        results = sortResults(mergeResultsByUrl(results, secondRound.results));
        await stage("boutique-search", "done", `${secondRound.results.length} uygun ilan eklendi`, {
          found: totalCandidates,
          eligible: results.length
        });
      } else {
        await stage("boutique-search", "skipped", "Yeni ilan bulunamadı");
      }
    } else {
      await stage("alternative-search", "skipped", "Cache yeterli ilan verdi");
      await stage("boutique-search", "skipped", "Canlı taramaya gerek kalmadı");
    }

    await stage("match", "running", "Uygunluk ve teknik analiz");

    // §10 — Aynı ilan birden çok platformda bulunabilir; kullanıcı aynı işi
    // birkaç kez görmemeli ve aynı işe birkaç başvuru paketi hazırlanmamalı.
    const beforeDedupe = results.length;
    const deduped = dedupeListings(results);

    if (deduped.removed > 0) {
      console.log(
        `[search] ${deduped.removed} kopya ilan birleştirildi (${results.length} → ${deduped.unique.length}).`
      );
    }

    // §11 — Kanonik ilan: aynı ilanın görüldüğü tüm kaynaklar birincil kayda
    // işlenir; kullanıcı tek ilan görür, altında "N kaynakta bulundu" yazar.
    results = deduped.groups.map((group) => {
      const sources = Array.from(
        new Set([group.primary, ...group.duplicates].map((item) => String(item.platform)))
      );
      return sources.length > 1 ? { ...group.primary, foundInSources: sources } : group.primary;
    });

    await stage("match", "done", `${results.length} ilan uygunluk analizinden geçti${deduped.removed ? `, ${deduped.removed} kopya birleştirildi` : ""}`, {
      eliminated: Math.max(0, totalCandidates - results.length),
      eligible: results.length
    });

    if (results.length === 0) {
      return {
        results: [],
        fallbackResults: [],
        summary: {
          ...baseSummary,
          errorType: "no_match",
          sourceNote:
            (totalCandidates
              ? `${totalCandidates} aday ilan değerlendirildi ancak "${profile.targetRole}" profiline yeterince uyan ilan bulunamadı.`
              : `"${profile.targetRole}" için uygun aktif ilan bulunamadı.`) + liveCrawlNote
        }
      };
    }

    return {
      results,
      fallbackResults: [],
      summary: {
        ...baseSummary,
        resultCount: results.length,
        realJobCount: results.length,
        errorType: "none",
        sourceNote: buildCacheSourceNote(results.length, totalCandidates) + liveCrawlNote
      }
    };
  } catch (error) {
    console.error("[searchJobListings] cache search failed:", error);
    return {
      results: [],
      fallbackResults: [],
      summary: {
        ...baseSummary,
        errorType: "crawler_failed",
        sourceNote:
          error instanceof Error
            ? `İlan eşleştirme sırasında hata oluştu: ${error.message}`
            : "İlan eşleştirme sırasında beklenmeyen bir hata oluştu."
      }
    };
  }
}

/**
 * Canlı crawler'ı çalıştırır, bulunan ilanları cache'e yazar.
 * Hata tüm aramayı düşürmez; kullanıcıya not olarak yansır.
 */
/** Kaynak sınıfı → kullanıcıya gösterilecek Türkçe etiket (§14). */
const COVERAGE_LABELS: Record<string, string> = {
  "general-board": "genel",
  "niche-board": "niş",
  "startup-board": "startup",
  "company-career": "şirket kariyer",
  ats: "ATS",
  government: "kamu",
  university: "üniversite",
  techpark: "teknokent",
  aggregator: "toplayıcı",
  "regional-board": "bölgesel",
  "remote-board": "remote",
  github: "GitHub"
};

type StageReporter = (
  key: "alternative-search" | "boutique-search",
  status: "running" | "done",
  detail?: string
) => Promise<void> | void;

async function runLiveCrawl(profile: CandidateProfile, reportStage?: StageReporter): Promise<string> {
  try {
    console.log(
      `[searchJobListings] Cache'te "${profile.targetRole}" için yeterli aday yok; canlı tarama başlıyor...`
    );

    const { crawlJobs } = await import("@/lib/jobs/crawler");
    const { upsertJobListing } = await import("@/lib/jobs/repository");

    // §12/§22 — Dalgalar arayüzdeki aşamalara eşlenir: dalga 1-2 "alternatif
    // pozisyonlar", dalga 3-4 "butik ve şirket kaynakları". Kullanıcı hangi
    // kaynak sınıfının tarandığını canlı görür.
    const crawlResult = await crawlJobs(profile, {
      onWave: async (wave, note) => {
        if (!reportStage) {
          return;
        }
        if (wave <= 2) {
          await reportStage("alternative-search", "running", `Dalga ${wave}: ${note}`);
        } else {
          await reportStage("boutique-search", "running", `Dalga ${wave}: ${note}`);
        }
      }
    });

    let saved = 0;
    for (const listing of crawlResult.listings) {
      try {
        await upsertJobListing({
          sourceName: listing.platform,
          sourceCategory: listing.category,
          externalId: listing.externalId,
          title: listing.title,
          company: listing.company,
          location: listing.location,
          workMode: listing.workMode ?? null,
          description: listing.description,
          requirements: listing.requirements,
          candidateCriteria: listing.candidateCriteria,
          postedAt: listing.postedAt ?? null,
          sourceQuery: listing.sourceQuery,
          externalUrl: listing.url,
          parseStatus: "parsed",
          markChecked: true
        });
        saved += 1;
      } catch (error) {
        console.error("[searchJobListings] Canlı ilan cache'e yazılamadı:", error);
      }
    }

    const okPlatforms = crawlResult.statuses.filter((status) => status.parsedListings > 0).length;
    console.log(`[searchJobListings] Canlı tarama bitti: ${saved} ilan cache'e eklendi (${okPlatforms} platform).`);

    // §14 — Kapsama özeti: hangi kaynak sınıfları tarandı. Dar kapsam gizlenmez.
    const coverageNote = crawlResult.coverage?.length
      ? ` Kapsam: ${crawlResult.coverage
          .map((entry) => `${COVERAGE_LABELS[entry.sourceType] ?? entry.sourceType} ${entry.succeeded}/${entry.scanned}`)
          .join(", ")}.`
      : "";

    return saved > 0
      ? ` Canlı taramayla ${okPlatforms} kaynaktan ${saved} güncel ilan eklendi.${coverageNote}`
      : ` Canlı tarama yapıldı ancak kaynaklardan yeni ilan alınamadı.${coverageNote}`;
  } catch (error) {
    console.error("[searchJobListings] Canlı tarama hata verdi:", error);
    return " Canlı tarama bu turda tamamlanamadı.";
  }
}

/** Sonuçları puana göre sıralar (kind=job filtreli). */
/**
 * §14 — Sıralama yalnızca yüzdelik skora göre yapılmaz.
 *
 * Öncelik: uygunluk → pozisyon uygunluğu → toplam skor → ilan güncelliği.
 * Böylece "teknik olarak parlak ama adayın başvuramayacağı" ilan, gerçekten
 * uygun bir ilanın üstüne çıkamaz. Uygunluk verisi olmayan (AI'siz) sonuçlar
 * eski davranışa düşer ve skora göre sıralanır.
 */
function sortResults(results: JobSearchResult[]): JobSearchResult[] {
  return results
    .filter((result) => result.kind === "job")
    .sort((left, right) => {
      const leftEligible = left.eligibility?.eligible ?? true;
      const rightEligible = right.eligibility?.eligible ?? true;

      if (leftEligible !== rightEligible) {
        return leftEligible ? -1 : 1;
      }

      // Uygunlar arasında sıralama DÜZ matchScore'dur. Pozisyon alt-skoru
      // zaten toplam puanın %60'ı olarak matchScore'un içindedir; burada
      // ikinci bir eksen olarak kullanılınca %69'un altına %55, üstüne %63
      // gelebiliyor ve kullanıcıya sıralama RASTGELE görünüyordu (canlı
      // kayıtta birebir görüldü, kullanıcı da bildirdi). Gösterilen sayı
      // neyse sıralama da o olmalı.
      if (left.matchScore !== right.matchScore) {
        return right.matchScore - left.matchScore;
      }

      const leftDate = left.postedAt ? Date.parse(left.postedAt) : 0;
      const rightDate = right.postedAt ? Date.parse(right.postedAt) : 0;
      return (Number.isNaN(rightDate) ? 0 : rightDate) - (Number.isNaN(leftDate) ? 0 : leftDate);
    });
}

/** İki sonuç kümesini URL bazında birleştirir; aynı ilan iki kez listelenmez. */
function mergeResultsByUrl(first: JobSearchResult[], second: JobSearchResult[]): JobSearchResult[] {
  const seen = new Set(first.map((result) => normalizeUrl(result.url)));
  return [...first, ...second.filter((result) => !seen.has(normalizeUrl(result.url)))];
}

function buildCacheSourceNote(resultCount: number, candidateCount: number): string {
  if (resultCount > 0) {
    return `Veritabanı cache'inden ${candidateCount} aktif ilan değerlendirildi; CV uyumuna göre ${resultCount} gerçek ilan sıralandı.`;
  }
  return `${candidateCount} aktif ilan değerlendirildi ancak CV profilinizle yeterli uyum sağlanamadı.`;
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

  // Kullanıcının analiz sonrası seçtiği pozisyonlar her şeyin önüne geçer:
  // hedef rol ve arama sorguları bu seçime hizalanır.
  const selectedPositions = cleanTerms(input.selectedPositions ?? []).slice(0, 5);
  const aiTitles = cleanTerms(ai?.targetPositions ?? []);
  const allTitles = unique([...selectedPositions, ...titles, ...aiTitles]).slice(0, 8);
  const targetRole =
    selectedPositions[0] ?? allTitles[0] ?? inferTitleForSearch([...skills, ...searchKeywords]) ?? fallbackTargetRole;

  // Merge AI query variations with standard keywords
  const aiQueryVariations = cleanTerms(ai?.queryVariations ?? []);
  // Kullanıcının notundaki anlamlı kelimeler cache aramasında ve ucuz
  // ön-skorda da sinyal olur (AI skorlaması notun tamamını ayrıca görür).
  //
  // Durak kelimeler elenmezse "çalışmak istiyorum lütfen" gibi ifadeler
  // keywords listesinin BAŞINA geçip gerçek beceri sinyallerini bastırıyordu.
  const noteTerms =
    typeof input.searchNote === "string"
      ? cleanTerms(input.searchNote.split(/[\s,;.!?]+/))
          .filter((term) => term.length >= 4 && !NOTE_STOPWORDS.has(term.toLocaleLowerCase("tr-TR")))
          .slice(0, 8)
      : [];
  const keywords = unique([
    ...noteTerms,
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
    desiredSeniority:
      typeof input.seniorityFilter === "string" && input.seniorityFilter !== "any"
        ? input.seniorityFilter
        : undefined,
    searchNote: typeof input.searchNote === "string" && input.searchNote.trim() ? input.searchNote.trim().slice(0, 600) : undefined,
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
