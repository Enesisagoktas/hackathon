import * as cheerio from "cheerio";

import type { CandidateProfile, CrawlJobsResult, CrawledJobListing, JobAdapter, JobPlatform, PlatformCrawlStatus, PlatformSelectors } from "@/lib/jobs/types";
import type { WorkMode } from "@/lib/search-preferences";
import {
  absoluteUrl,
  cleanText,
  extractExternalId,
  extractJsonLdJobs,
  inferCity,
  inferWorkMode,
  normalizeComparable,
  normalizeUrl,
  readNestedString,
  readString,
  slugify,
  truncateText,
  uniq
} from "@/lib/jobs/normalize";
import { filterListingsByProfile } from "@/lib/jobs/relevance";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 CVMatchBot/1.0";
const FETCH_TIMEOUT_MS = Number(process.env.CRAWLER_FETCH_TIMEOUT_MS ?? 9000);
const FETCH_HARD_TIMEOUT_MS = Number(process.env.CRAWLER_FETCH_HARD_TIMEOUT_MS ?? FETCH_TIMEOUT_MS * 2 + 8000);
const MAX_SEARCH_URLS_PER_PLATFORM = Number(process.env.CRAWLER_MAX_SEARCH_URLS_PER_PLATFORM ?? 2);
const MAX_DETAILS_PER_PLATFORM = Number(process.env.CRAWLER_MAX_DETAILS_PER_PLATFORM ?? 4);
const MAX_CONCURRENT_PLATFORMS = Number(process.env.CRAWLER_MAX_CONCURRENT_PLATFORMS ?? 6);
const MAX_CONCURRENT_DETAILS = Number(process.env.CRAWLER_MAX_CONCURRENT_DETAILS ?? 3);
const PLATFORM_REQUEST_INTERVAL_MS = Number(process.env.CRAWLER_PLATFORM_REQUEST_INTERVAL_MS ?? 2000);
const CRAWLER_DEADLINE_MS = Number(process.env.CRAWLER_DEADLINE_MS ?? 90000);

const platformRequestQueues = new Map<JobPlatform, { lastRequestAt: number; queue: Promise<void> }>();

class CrawlDeadlineError extends Error {
  constructor() {
    super("Crawler genel süre sınırına ulaştı; eldeki sonuçlarla devam edildi.");
  }
}

// ─── Platform-Specific Selectors ────────────────────────────────────────────

const KARIYER_SELECTORS: PlatformSelectors = {
  title: ['h1.job-title', 'h1[class*="title"]', '.cmp-info-header h1', 'h1'],
  company: ['.cmp-info-header a[href*="firma"]', '.company-name a', '[class*="company"] a', '[class*="firma"]'],
  location: ['.cmp-info-header [class*="location"]', '[class*="city"]', '[class*="lokasyon"]'],
  description: ['.job-description', '[class*="job-description"]', '[class*="ilan-detay"]', '.detail-content'],
  requirements: ['[class*="qualifications"]', '[class*="nitelikler"]'],
  date: ['time[datetime]', '[class*="date"]', '[class*="tarih"]']
};

const SECRETCV_SELECTORS: PlatformSelectors = {
  title: ['h1.position-title', 'h1[class*="title"]', 'h1'],
  company: ['.company-info a', '[class*="company-name"]', '[class*="firma"]'],
  location: ['[class*="location"]', '[class*="lokasyon"]', '[class*="sehir"]'],
  description: ['.job-description', '[class*="description"]', '.position-detail'],
  date: ['[class*="date"]', 'time']
};

const ELEMAN_SELECTORS: PlatformSelectors = {
  title: ['h1.ilan-baslik', 'h1[class*="title"]', 'h1'],
  company: ['.firma-adi a', '[class*="company"]', '[class*="firma"]'],
  location: ['[class*="lokasyon"]', '[class*="location"]', '[class*="sehir"]'],
  description: ['.ilan-aciklama', '[class*="description"]', '[class*="aciklama"]'],
  date: ['[class*="tarih"]', '[class*="date"]', 'time']
};

const JOB_ADAPTERS: JobAdapter[] = [
  {
    platform: "Kariyer.net",
    category: "general",
    selectors: KARIYER_SELECTORS,
    // Ölçüm (canlı): `?k=` parametresi sunucuda düşüyor ve `/is-ilanlari?fpi=1`
    // genel sayfasına yönlendiriyor; doğru parametre `kw`. Slug yolu ise yalnızca
    // Türkçe karşılığı varsa çalışıyor ("yazilim-gelistirici" → 146 eşleşme,
    // "frontend-developer" → genel sayfaya yönlendi).
    buildSearchUrls: (query) => [
      `https://www.kariyer.net/is-ilanlari?kw=${encodeURIComponent(query)}`,
      `https://www.kariyer.net/is-ilanlari/${slugify(query)}`
    ],
    isDetailUrl: (url) => url.hostname.includes("kariyer.net") && url.pathname.startsWith("/is-ilani/")
  },
  {
    platform: "Secretcv",
    category: "general",
    selectors: SECRETCV_SELECTORS,
    buildSearchUrls: (query) => [`https://www.secretcv.com/is-ilanlari/${slugify(query)}-is-ilanlari`],
    // BUG FIX: Secretcv detail URLs look like /firma-slug/ilan-title-is-ilanlari-1857978
    // The old regex excluded URLs containing 'is-ilanlari' which killed ALL results.
    // Now we match URLs with numeric ID suffix that are NOT the search listing pages.
    isDetailUrl: (url) => {
      if (!url.hostname.includes("secretcv.com")) return false;
      // Exclude pure search pages like /is-ilanlari/xxx-is-ilanlari
      if (/^\/is-ilanlari(\/|$)/.test(url.pathname)) return false;
      // Exclude non-job pages
      if (/\/(firma|giris|cv-olustur|blog|iletisim|kurumsal)/.test(url.pathname)) return false;
      // Match detail pages: /{firma-slug}/{title}-is-ilanlari-{numeric-id}
      return /-is-ilanlari-\d+$/.test(url.pathname) || /-\d{6,}$/.test(url.pathname);
    }
  },
  {
    platform: "Eleman.net",
    category: "general",
    selectors: ELEMAN_SELECTORS,
    buildSearchUrls: (query) => [`https://www.eleman.net/is-ilanlari/${slugify(query)}`],
    // Detail URLs: /is-ilani/slug-i1234567
    isDetailUrl: (url) =>
      url.hostname.includes("eleman.net") &&
      (/\/is-ilani\//.test(url.pathname) || /-i\d{5,}/.test(url.pathname))
  },
  {
    platform: "Yenibiriş",
    category: "general",
    buildSearchUrls: (query) => [`https://www.yenibiris.com/is-ilanlari?kelime=${encodeURIComponent(query)}`],
    // Yenibiriş detail URLs: /is-ilani/{slug}
    isDetailUrl: (url) =>
      url.hostname.includes("yenibiris.com") &&
      /\/is-ilani\//.test(url.pathname)
  },
  {
    platform: "Toptalent",
    category: "tech",
    // Fixed: Toptalent uses /is-ilanlari, not /jobs
    // Genel `/is-ilanlari` sayfası sorguyu tamamen yok sayıyordu ve her aramada
    // aynı alakasız ilanları cache'e yazıyordu; çıkarıldı.
    buildSearchUrls: (query) => [
      `https://toptalent.co/is-ilanlari/${slugify(query)}-is-ilanlari`,
      `https://toptalent.co/is-ilanlari?q=${encodeURIComponent(query)}`
    ],
    // Detail URLs: /company-title-123456 (direct slug with numeric ID)
    isDetailUrl: (url) => {
      if (!url.hostname.includes("toptalent.co")) return false;
      if (/^\/is-ilanlari/.test(url.pathname)) return false;
      if (/^\/(hakkimizda|iletisim|sirket|cv-hazirlama|online-egitim|yetenek|awards|etkinlik|blog|kariyer)/.test(url.pathname)) return false;
      // Detail pages have compound slugs with numeric IDs like /dohler-dispatch-long-term-intern-121518
      return /\/[a-z0-9-]+-\d{4,}$/i.test(url.pathname);
    }
  },
  {
    platform: "LinkedIn",
    category: "general",
    buildSearchUrls: (query) => [
      `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=Turkey&f_TPR=r604800`
    ],
    // LinkedIn detail URLs: /jobs/view/slug-123456
    isDetailUrl: (url) =>
      (url.hostname.includes("linkedin.com")) &&
      /\/jobs\/view\//.test(url.pathname)
  },
  {
    platform: "İŞKUR",
    category: "public",
    buildSearchUrls: () => ["https://esube.iskur.gov.tr/istihdam/AcikIsIlanAra.aspx"],
    isDetailUrl: () => false
  }
];

// LinkedIn is excluded from the MVP by default (aggressive anti-bot). Opt in
// with CRAWLER_ENABLE_LINKEDIN=true.
const ENABLE_LINKEDIN = /^(1|true|yes|on)$/i.test(process.env.CRAWLER_ENABLE_LINKEDIN ?? "");

function getActiveAdapters(): JobAdapter[] {
  return JOB_ADAPTERS.filter((adapter) => adapter.platform !== "LinkedIn" || ENABLE_LINKEDIN);
}

export async function crawlJobs(profile: CandidateProfile): Promise<CrawlJobsResult> {
  const queries = buildCrawlQueries(profile);
  const deadlineAt = Date.now() + CRAWLER_DEADLINE_MS;
  const adapterResults = await runLimited(
    getActiveAdapters().map((adapter) => () => {
      console.log(`[Crawler] Starting platform: ${adapter.platform}...`);
      return crawlAdapter(adapter, queries, profile, deadlineAt);
    }),
    Math.max(1, MAX_CONCURRENT_PLATFORMS)
  );

  const listings = uniqListings(adapterResults.flatMap((result) => result.listings));
  const statuses = adapterResults.map((result) => result.status);

  return { listings, statuses };
}

/**
 * Build rich crawl queries using AI-generated variations + standard combinations.
 * This replaces the old narrow 5-query approach.
 */
function buildCrawlQueries(profile: CandidateProfile) {
  const primarySkill = profile.skills[0];
  const secondarySkill = profile.skills[1];
  const primaryKeyword = profile.keywords.find((keyword) => !profile.skills.includes(keyword));
  const location = profile.locationMode === "cities" ? profile.locations[0] : undefined;

  // Seviye filtresi sorgulara da yansır: "stajyer hemşire" gibi aramalar
  // platformlarda doğrudan seviyeye uygun ilanları öne çıkarır.
  const seniorityTerm = getSeniorityQueryTerm(profile.desiredSeniority);

  const standardQueries = [
    profile.targetRole,
    joinQuery([seniorityTerm, profile.targetRole]),
    joinQuery([profile.targetRole, primarySkill]),
    joinQuery([profile.targetRole, primarySkill, secondarySkill]),
    joinQuery([profile.targetRole, primaryKeyword]),
    joinQuery([primarySkill, primaryKeyword]),
    joinQuery([profile.targetRole, location])
  ];

  // Add AI-generated query variations (TR/EN synonyms)
  const aiQueries = profile.queryVariations ?? [];

  // Add alternative titles as queries
  const titleQueries = profile.titles.slice(1, 4);
  const seniorityTitleQueries = seniorityTerm
    ? profile.titles.slice(1, 3).map((title) => joinQuery([seniorityTerm, title]))
    : [];

  // Şehir seçiliyse sorgulara da girsin: aksi halde crawler ülke geneli tarar,
  // gelen ilanların çoğu lokasyon filtresine takılır ve tarama boşa gider.
  const cityQueries =
    profile.locationMode === "cities"
      ? profile.locations.slice(0, 2).flatMap((city) => [
          joinQuery([profile.targetRole, city]),
          joinQuery([seniorityTerm, profile.targetRole, city])
        ])
      : [];

  // Combine all queries, deduplicate, limit
  const allQueries = [
    ...standardQueries,
    ...cityQueries,
    ...seniorityTitleQueries,
    ...aiQueries,
    ...titleQueries
  ];

  return uniq(allQueries.filter((query) => query.length >= 3)).slice(0, 12);
}

async function crawlAdapter(
  adapter: JobAdapter,
  queries: string[],
  profile: CandidateProfile,
  deadlineAt: number
): Promise<{ listings: CrawledJobListing[]; status: PlatformCrawlStatus }> {
  const startedStatus: PlatformCrawlStatus = {
    platform: adapter.platform,
    status: "empty",
    searchedUrls: 0,
    discoveredUrls: 0,
    parsedListings: 0
  };

  if (adapter.platform === "İŞKUR") {
    return {
      listings: [],
      status: {
        ...startedStatus,
        status: "failed" as const,
        searchedUrls: 1,
        message: "İŞKUR stateful ASP.NET form yapısı kullandığı için statik crawler ile ilan çekilemiyor. Yedek arama linki sunuldu."
      }
    };
  }

  try {
    assertWithinDeadline(deadlineAt);

    const searchUrls = uniq(queries.flatMap((query) => adapter.buildSearchUrls(query, profile))).slice(
      0,
      MAX_SEARCH_URLS_PER_PLATFORM
    );
    const discoveredByUrl = new Map<string, string>();
    let hitDeadline = false;

    for (const searchUrl of searchUrls) {
      if (isDeadlineExceeded(deadlineAt)) {
        hitDeadline = true;
        break;
      }

      const page = await fetchPlatformHtml(adapter.platform, searchUrl, deadlineAt).catch((error) => {
        if (error instanceof CrawlDeadlineError) {
          hitDeadline = true;
        }

        return { html: "", finalUrl: searchUrl };
      });

      if (!page.html) {
        continue;
      }

      // Site sorguyu karşılayamayıp genel ilan listesine yönlendirdiyse o sayfa
      // bir arama sonucu değildir; içindeki ilanlar sorguyla ilgisizdir.
      if (hasFallenBackToGenericListing(searchUrl, page.finalUrl)) {
        console.log(
          `[crawler] ${adapter.platform}: "${searchUrl}" genel ilan sayfasına yönlendi (${page.finalUrl}); sonuçları alınmadı.`
        );
        continue;
      }

      const sourceQuery = findSourceQueryForUrl(searchUrl, adapter, queries, profile);
      let listingUrls = discoverListingUrls(page.html, searchUrl, adapter);

      // Sayfa doluysa ama tek bir ilan linki bile yoksa ilanlar JavaScript ile
      // geliyordur. Eski tetikleyici yalnızca "HTML 500 bayttan küçükse" tarayıcı
      // açıyordu; ölçümde Secretcv'nin 231 KB'lık JS sayfası bu yüzden hiç
      // işlenemiyor, platform her aramada 0 ilan döndürüyordu.
      if (!listingUrls.length && !isDeadlineExceeded(deadlineAt)) {
        const rendered = await fetchPlatformHtml(adapter.platform, searchUrl, deadlineAt, {
          forceBrowser: true
        }).catch((error) => {
          if (error instanceof CrawlDeadlineError) {
            hitDeadline = true;
          }

          return { html: "", finalUrl: searchUrl };
        });

        if (rendered.html) {
          listingUrls = discoverListingUrls(rendered.html, searchUrl, adapter);
          if (listingUrls.length) {
            console.log(
              `[crawler] ${adapter.platform}: "${searchUrl}" tarayıcıyla işlendi, ${listingUrls.length} ilan linki bulundu.`
            );
          }
        }
      }

      listingUrls.forEach((url) => {
        if (!discoveredByUrl.has(url)) {
          discoveredByUrl.set(url, sourceQuery);
        }
      });
    }

    // NO URL pre-filtering! Fetch all discovered detail pages and score by content.
    // This fixes the issue where relevant jobs were killed by isPotentiallyRelevantUrl()
    const detailEntries = Array.from(discoveredByUrl.entries())
      .slice(0, MAX_DETAILS_PER_PLATFORM);

    const parsedListings = await runLimited(
      detailEntries.map(([url, sourceQuery]) => async () => {
        if (isDeadlineExceeded(deadlineAt)) {
          hitDeadline = true;
          return null;
        }

        const detail = await fetchPlatformHtml(adapter.platform, url, deadlineAt).catch((error) => {
          if (error instanceof CrawlDeadlineError) {
            hitDeadline = true;
          }

          return { html: "", finalUrl: url };
        });

        if (!detail.html) {
          return null;
        }

        return parseJobDetail(detail.html, url, adapter, sourceQuery);
      }),
      MAX_CONCURRENT_DETAILS
    );
    const parsed = parsedListings.filter((listing): listing is CrawledJobListing => Boolean(listing));

    // İlan siteleri, arama hiçbir şey bulamadığında genel ilan listesini döner.
    // O sayfadaki alakasız ilanlar cache'e yazılırsa bütün kullanıcıları etkiler.
    const { kept: listings, dropped } = filterListingsByProfile(parsed, profile);

    if (dropped.length) {
      console.log(
        `[crawler] ${adapter.platform}: ${dropped.length} ilan profille ilgisiz olduğu için alınmadı (örn. "${dropped[0].title.slice(0, 60)}").`
      );
    }

    const crawlStatus: PlatformCrawlStatus["status"] = listings.length
      ? hitDeadline
        ? "timeout"
        : listings.length < detailEntries.length
        ? "partial"
        : "success"
      : hitDeadline
        ? "timeout"
        : "empty";

    return {
      listings,
      status: {
        ...startedStatus,
        status: crawlStatus,
        searchedUrls: searchUrls.length,
        discoveredUrls: discoveredByUrl.size,
        parsedListings: listings.length,
        message: hitDeadline
          ? "Crawler süre sınırına ulaştı; eldeki ilanlarla devam edildi."
          : listings.length
          ? undefined
          : discoveredByUrl.size
            ? "İlan URL'leri bulundu ama detay sayfaları parse edilemedi."
            : "Arama sayfasında gerçek ilan detay linki bulunamadı."
      }
    };
  } catch (error) {
    const status = error instanceof CrawlDeadlineError ? "timeout" : "failed";

    return {
      listings: [],
      status: {
        ...startedStatus,
        status,
        message: error instanceof Error ? error.message : "Crawler hata verdi."
      }
    };
  }
}

async function fetchPlatformHtml(
  platform: JobPlatform,
  url: string,
  deadlineAt: number,
  options: { forceBrowser?: boolean } = {}
) {
  let state = platformRequestQueues.get(platform);

  if (!state) {
    state = { lastRequestAt: 0, queue: Promise.resolve() };
    platformRequestQueues.set(platform, state);
  }

  const request = state.queue.then(async () => {
    assertWithinDeadline(deadlineAt);

    const elapsed = Date.now() - state.lastRequestAt;
    const waitMs = state.lastRequestAt ? Math.max(0, PLATFORM_REQUEST_INTERVAL_MS - elapsed) : 0;

    if (waitMs > 0) {
      const remainingMs = deadlineAt - Date.now();

      if (remainingMs <= waitMs) {
        throw new CrawlDeadlineError();
      }

      console.log(`[Crawler] ${platform} rate limit: waiting ${Math.ceil(waitMs / 1000)}s before ${url}`);
      await sleep(waitMs);
    }

    assertWithinDeadline(deadlineAt);
    state.lastRequestAt = Date.now();
    return withTimeout(fetchHtml(url, options), FETCH_HARD_TIMEOUT_MS, `Crawler isteği zaman aşımına uğradı: ${url}`);
  });

  state.queue = request.then(() => undefined, () => undefined);
  return request;
}

export type FetchedPage = { html: string; finalUrl: string };

async function fetchHtml(url: string, options: { forceBrowser?: boolean } = {}): Promise<FetchedPage> {
  const regular = options.forceBrowser
    ? { html: "", finalUrl: url }
    : await fetchHtmlRegular(url).catch(() => ({ html: "", finalUrl: url }));

  if (regular.html && regular.html.length > 500) {
    return regular;
  }

  // Browser fallback handles JS rendering and anti-bot pages, but only after fast fetch fails.
  try {
    const { fetchWithBrowser, checkBrowserAvailability } = await import("@/lib/jobs/browser-pool");
    const available = await checkBrowserAvailability();

    if (available) {
      const html = await fetchWithBrowser(url, FETCH_TIMEOUT_MS + 5000);

      if (html && html.length > 500) {
        // Tarayıcı yolu son URL'yi bildirmiyor; yönlendirme denetimi için
        // istenen adres korunur (yanlış pozitif eleme yapmamak için güvenli taraf).
        return { html, finalUrl: url };
      }
    }
  } catch {
    // Browser not available or failed; return the regular response if it had anything useful.
  }

  return regular;
}

async function fetchHtmlRegular(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
      },
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      return { html: "", finalUrl: response.url || url };
    }

    return { html: await response.text(), finalUrl: response.url || url };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Arama sayfasının, sorguyu karşılayamadığı için sitenin genel ilan listesine
 * yönlendirilip yönlendirilmediği.
 *
 * Ölçüm: `kariyer.net/is-ilanlari/frontend-developer` → 302 → `/is-ilanlari`
 * (tüm ilanlar). Crawler bunu geçerli bir arama sonucu sanıp sayfadaki garson,
 * satış temsilcisi vb. ilanları "Frontend Developer" sorgusuyla kaydediyordu.
 * Böyle bir sayfa hiç işlenmemelidir.
 */
export function hasFallenBackToGenericListing(requestedUrl: string, finalUrl: string): boolean {
  try {
    const from = new URL(requestedUrl);
    const to = new URL(finalUrl);

    if (from.host !== to.host) {
      return true;
    }

    const normalize = (value: string) => value.replace(/\/+$/, "").toLowerCase();
    const fromPath = normalize(from.pathname);
    const toPath = normalize(to.pathname);

    // Yol kısaldıysa arama terimi düşmüş demektir (ör. /is-ilanlari/x → /is-ilanlari).
    if (toPath !== fromPath && fromPath.startsWith(toPath)) {
      return true;
    }

    // Sorgu parametresi düştüyse de arama uygulanmamış demektir
    // (ör. ?fpi=1&k=frontend+developer → ?fpi=1).
    for (const [key, value] of Array.from(from.searchParams.entries())) {
      if (value && !to.searchParams.get(key)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

function discoverListingUrls(html: string, searchUrl: string, adapter: JobAdapter) {
  const $ = cheerio.load(html);
  const candidates: string[] = [];

  $('a[href]').each((_, element) => {
    const href = $(element).attr("href");
    if (href) {
      candidates.push(href);
    }
  });

  const normalizedHtml = html.replace(/\\\//g, "/").replace(/\u002F/g, "/");
  const urlMatches = normalizedHtml.match(/https?:\/\/[^"'<>\s)]+/g) ?? [];
  const relativeMatches = normalizedHtml.match(/\/(?:is-ilani|ilan|jobs)\/[^"'<>\s)]+/g) ?? [];
  candidates.push(...urlMatches, ...relativeMatches);

  return uniq(
    candidates
      .map((candidate) => cleanupCandidateUrl(candidate))
      .map((candidate) => absoluteUrl(candidate, searchUrl))
      .filter((url): url is string => Boolean(url))
      .map(normalizeUrl)
      .filter((url) => {
        try {
          return adapter.isDetailUrl(new URL(url));
        } catch {
          return false;
        }
      })
  ).slice(0, MAX_DETAILS_PER_PLATFORM * 2);
}


/** İlanı tanımlamayan, her URL'de geçen yol parçaları. */
const SLUG_BOILERPLATE = new Set([
  "ilan",
  "ilani",
  "ilanlari",
  "isilani",
  "jobs",
  "job",
  "kariyer",
  "career",
  "careers",
  "view",
  "detail",
  "details",
  "pozisyon",
  "vacancy"
]);

/** <meta og:title> ya da <title> içeriğini okur (metin değil, `content` niteliği). */
function readMetaTitle($: cheerio.CheerioAPI): string | undefined {
  const og = $('meta[property="og:title"]').attr("content") ?? $('meta[name="title"]').attr("content");
  const raw = og ?? $("title").first().text();
  const cleaned = cleanText(raw ?? "");

  if (!cleaned) {
    return undefined;
  }

  // "Toptalent.co | Genel Muhasebe Uzmanı - FASDAT" → site adı atılır.
  const parts = cleaned.split(/\s*[|–—]\s*/).filter((part) => part.trim().length > 2);
  const withoutSite = parts.length > 1 ? parts.slice(1).join(" - ") : cleaned;

  return withoutSite.trim() || cleaned;
}

/**
 * Başlık ile ilan URL'sinin slugları en az bir anlamlı kelimeyi paylaşıyor mu?
 *
 * Paylaşmıyorsa başlık büyük ihtimalle sayfadaki BAŞKA bir ilandan alınmıştır.
 */
export function titleMatchesUrl(title: string, url: string): boolean {
  const titleWords = new Set(
    normalizeComparable(title)
      .split(" ")
      .filter((word) => word.length >= 4)
  );

  if (!titleWords.size) {
    // Başlıkta ayırt edici kelime yoksa karar verilemez; başlık reddedilmez.
    return true;
  }

  let slug = "";
  try {
    slug = normalizeComparable(decodeURIComponent(new URL(url).pathname));
  } catch {
    return true;
  }

  // Yol kalıpları ve kimlik numaraları ilanı tanımlamaz; bunlar atılır.
  // Kalan kelime yoksa URL'den karar çıkmaz ve başlık REDDEDİLMEZ — yanlış
  // reddetme, gerçek ilanları sessizce düşürür.
  const slugWords = slug
    .split(" ")
    .filter((word) => word.length >= 4 && !SLUG_BOILERPLATE.has(word) && !/^\d+$/.test(word));

  if (!slugWords.length) {
    return true;
  }

  return slugWords.some((word) => titleWords.has(word));
}

function parseJobDetail(html: string, url: string, adapter: JobAdapter, sourceQuery: string): CrawledJobListing | null {
  const jsonLdListing = parseJsonLdListing(html, url, adapter, sourceQuery);

  if (jsonLdListing) {
    return jsonLdListing;
  }

  const $ = cheerio.load(html);
  const pageText = cleanText($("body").text());

  // Use platform-specific selectors first, then fall back to generic ones
  const platformSelectors = adapter.selectors;
  
  // Ölçüm: Toptalent detay sayfalarında hiç <h1> yok. Eski kod bu durumda
  // '[class*="position"]' gibi genel bir seçiciye düşüp sayfadaki ilan
  // listesinden BAŞKA bir ilanın başlığını alıyordu; veritabanında başlıklar
  // URL'lerle çaprazlanmış kayıtlar oluştu. Ayrıca 'meta[property="og:title"]'
  // seçicisi metin okuduğu için hiç çalışmıyordu — başlık `content` niteliğinde.
  const metaTitle = readMetaTitle($);
  const selectorTitle = cleanupTitle(
    firstText($, platformSelectors?.title ?? []) ??
    firstText($, [
      "h1",
      '[class*="job-title"]',
      '[class*="JobTitle"]',
      '[data-test*="title"]'
    ])
  );

  // Seçiciden gelen başlık URL ile hiç örtüşmüyorsa yanlış ilanın başlığı alınmış
  // olabilir; böyle bir durumda sayfanın kendi meta başlığı tercih edilir.
  const title =
    selectorTitle && titleMatchesUrl(selectorTitle, url)
      ? selectorTitle
      : cleanupTitle(metaTitle) ?? selectorTitle;

  const description = extractDescription($, pageText, platformSelectors?.description);

  if (!isUsableDetail(title, description, url)) {
    return null;
  }

  const company = cleanupCompany(
    firstText($, platformSelectors?.company ?? []) ??
    firstText($, [
      '[class*="company"] a',
      '[class*="Company"] a',
      '[class*="company-name"]',
      '[class*="firma"]',
      '[href*="firma"]',
      '[href*="sirket"]'
    ])
  );

  const location = 
    firstText($, platformSelectors?.location ?? []) ??
    firstText($, ['[class*="location"]', '[class*="Location"]', '[class*="city"]', '[class*="lokasyon"]']) ??
    inferCity(pageText);

  const workMode = inferWorkMode(pageText);

  return {
    platform: adapter.platform,
    category: adapter.category,
    externalId: extractExternalId(url),
    title,
    company,
    location,
    workMode,
    description,
    requirements: extractRequirements(pageText),
    candidateCriteria: extractCandidateCriteria(pageText),
    url,
    sourceQuery,
    postedAt: firstText($, platformSelectors?.date ?? ['time[datetime]', '[class*="date"]'])
  };
}

function parseJsonLdListing(html: string, url: string, adapter: JobAdapter, sourceQuery: string): CrawledJobListing | null {
  const job = extractJsonLdJobs(html)[0];

  if (!job) {
    return null;
  }

  const title = cleanupTitle(readString(job.title));
  const description = cleanText(readString(job.description));

  if (!isUsableDetail(title, description, url)) {
    return null;
  }

  const company = cleanupCompany(readNestedString(job.hiringOrganization, ["name"]));
  const location = extractJsonLdLocation(job) ?? inferCity(description);
  const workMode = inferWorkMode([description, readString(job.employmentType), readString(job.jobLocationType)].join(" "));
  const postedAt = readString(job.datePosted);

  return {
    platform: adapter.platform,
    category: adapter.category,
    externalId: extractExternalId(url),
    title,
    company,
    location,
    workMode,
    description,
    requirements: extractRequirements(description),
    candidateCriteria: extractCandidateCriteria(description),
    url,
    sourceQuery,
    postedAt
  };
}

function extractJsonLdLocation(job: Record<string, unknown>) {
  const jobLocation = job.jobLocation;
  const location = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;

  if (!location || typeof location !== "object") {
    return undefined;
  }

  const address = (location as Record<string, unknown>).address;
  if (address && typeof address === "object") {
    return [
      readNestedString(address, ["addressLocality"]),
      readNestedString(address, ["addressRegion"]),
      readNestedString(address, ["addressCountry"])
    ]
      .filter(Boolean)
      .join(", ");
  }

  return readString((location as Record<string, unknown>).name);
}

function extractDescription($: cheerio.CheerioAPI, pageText: string, platformSelectors?: string[]) {
  // Try platform-specific selectors first
  if (platformSelectors?.length) {
    const platformDesc = firstText($, platformSelectors);
    if (platformDesc && platformDesc.length > 120) {
      return truncateText(platformDesc, 5000);
    }
  }

  const description = firstText($, [
    '[class*="job-description"]',
    '[class*="JobDescription"]',
    '[class*="description"]',
    '[class*="Description"]',
    '[class*="detail-content"]',
    '[class*="job-detail"]',
    '[class*="ilan-detay"]',
    '[class*="ilan-aciklama"]',
    "article",
    "main"
  ]);

  return truncateText(description && description.length > 120 ? description : pageText, 5000);
}

function firstText($: cheerio.CheerioAPI, selectors: string[]) {
  for (const selector of selectors) {
    const element = $(selector).first();

    if (!element.length) {
      continue;
    }

    const attrContent = element.attr("content") ?? element.attr("datetime");
    const text = cleanText(attrContent ?? element.text());

    if (text) {
      return text;
    }
  }

  return undefined;
}

function extractRequirements(text: string) {
  return extractSectionSentences(text, /(aranan nitelikler|genel nitelikler|qualifications|required skills|requirements)/i);
}

function extractCandidateCriteria(text: string) {
  return extractSectionSentences(text, /(aday kriterleri|candidate profile|candidate criteria|what we are looking for)/i);
}

/**
 * BUG FIX: Changed `if (!markerMatch?.index)` to `if (markerMatch?.index == null)`
 * The old code treated index=0 as falsy, which would skip sections at the start of text.
 * `!0` === `true` was causing valid sections to be silently dropped.
 */
function extractSectionSentences(text: string, marker: RegExp) {
  const markerMatch = text.match(marker);

  if (markerMatch?.index == null) {
    return [];
  }

  return text
    .slice(markerMatch.index, markerMatch.index + 1500)
    .split(/[-–•\n]|\.\s+/)
    .map(cleanText)
    .filter((item) => item.length > 12)
    .slice(0, 8);
}

function isUsableDetail(title: string | undefined, description: string, url: string) {
  if (!title || title.length < 3 || title.length > 180) {
    return false;
  }

  if (/iş ilanları|is ilanlari|jobs|kariyer\.net|secretcv|eleman\.net|yenibiris|linkedin/i.test(title) && !/specialist|developer|manager|uzman|mühendis|analist|sorumlu|temsilci|geliştirici|engineer|intern|stajyer/i.test(title)) {
    return false;
  }

  if (description.length < 80) {
    return false;
  }

  try {
    return new URL(url).pathname.length > 5;
  } catch {
    return false;
  }
}

function cleanupTitle(value: string | undefined) {
  return cleanText(value)
    .replace(/\s+\|\s+.*$/g, "")
    .replace(/\s+-\s+(Kariyer\.net|Secretcv|Eleman\.net|Yenibiriş|Toptalent|LinkedIn).*$/i, "")
    .trim();
}

function cleanupCompany(value: string | undefined) {
  const text = cleanText(value);
  return text.length > 2 && text.length < 160 ? text : undefined;
}

function cleanupCandidateUrl(value: string) {
  return value
    .replace(/\\u002F/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .replace(/[),.;]+$/g, "")
    .trim();
}

function findSourceQueryForUrl(searchUrl: string, adapter: JobAdapter, queries: string[], profile: CandidateProfile) {
  return queries.find((query) => adapter.buildSearchUrls(query, profile).includes(searchUrl)) ?? queries[0] ?? profile.targetRole;
}

async function runLimited<T>(tasks: Array<() => Promise<T>>, limit: number) {
  const results: T[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

function uniqListings(listings: CrawledJobListing[]) {
  const seen = new Set<string>();

  return listings.filter((listing) => {
    const key = normalizeUrl(listing.url).toLocaleLowerCase("tr-TR");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

/** Seviye filtresini platform arama terimlerine çevirir. */
function getSeniorityQueryTerm(desiredSeniority: string | undefined): string | undefined {
  switch (desiredSeniority) {
    case "stajyer":
      return "stajyer";
    case "junior":
      return "junior";
    case "senior":
      return "senior";
    default:
      // "mid" için platformlarda yerleşik bir arama terimi yok; sorguyu kirletme.
      return undefined;
  }
}

function joinQuery(parts: Array<string | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join(" ");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function assertWithinDeadline(deadlineAt: number) {
  if (isDeadlineExceeded(deadlineAt)) {
    throw new CrawlDeadlineError();
  }
}

function isDeadlineExceeded(deadlineAt: number) {
  return Date.now() >= deadlineAt;
}
