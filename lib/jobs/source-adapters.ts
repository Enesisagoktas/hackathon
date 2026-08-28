import { cleanText, normalizeComparable, slugify, truncateText } from "@/lib/jobs/normalize";
import type { SourceRecord } from "@/lib/jobs/source-registry";
import type { CandidateProfile, CrawledJobListing, JobAdapter } from "@/lib/jobs/types";

/**
 * Registry kaynakları için adaptör üretimi (§2-§3).
 *
 * Sabit adaptör listesi 6-7 siteyle sınırlıydı; kaynak evreni büyüdükçe her
 * site için elle adaptör yazılamaz. Bu modül:
 *   • HTML kaynaklara arama şablonundan genel adaptör kurar (detay ayrıştırma
 *     zaten JSON-LD öncelikli çalışıyor — modern ilan siteleri ve tüm ATS'ler
 *     JobPosting şeması gömer),
 *   • JSON API kaynaklarını (Greenhouse, Lever, RemoteOK) doğrudan yapılandırılmış
 *     veriden okur — HTML ayrıştırma riski sıfır,
 *   • RSS kaynaklarını (WeWorkRemotely) besleme üzerinden okur.
 */

// ─── Genel HTML adaptörü ──────────────────────────────────────────────────

/** İlan detay sayfasına benzeyen yol kalıpları. */
const DETAIL_PATH_PATTERN =
  /\/(is-ilani|is-ilanlari|ilan|jobs?|job|careers?|kariyer|vacanc\w*|positions?|openings?|posting)s?\//i;

/** Detay sayfası OLMAYAN yollar: arama, kategori, kurumsal sayfalar. */
const NON_DETAIL_PATTERN =
  /\/(arama|search|kategori|category|firma|sirket|company|login|giris|kayit|register|blog|hakk\w+|iletisim|contact|cv-|uyelik)\b/i;

export function fillSearchTemplate(template: string, query: string): string {
  return template
    .replace(/\{query_slug\}/g, slugify(query))
    .replace(/\{query\}/g, encodeURIComponent(query));
}

/**
 * Registry kaydından genel adaptör kurar.
 *
 * isDetailUrl bilinçli olarak temkinlidir: kaynak sitenin alan adında olmayan
 * linkler reddedilir; yol kalıbı ilan detayına benzemeli ve nav/kurumsal
 * kalıplarına benzememelidir. Yanlış pozitifler zaten içerik doğrulamasında
 * (başlık-URL tutarlılığı, alaka kapısı, engel sayfası tespiti) elenir.
 */
export function buildGenericAdapter(source: SourceRecord): JobAdapter {
  let sourceHost = "";
  try {
    sourceHost = new URL(source.baseUrl).hostname.replace(/^www\./, "");
  } catch {
    sourceHost = "";
  }

  return {
    platform: source.name,
    category: source.sourceType === "general-board" || source.sourceType === "aggregator" ? "general" : "tech",
    buildSearchUrls: (query) => {
      if (source.searchUrlTemplate && source.searchSupported) {
        return [fillSearchTemplate(source.searchUrlTemplate, query)];
      }
      // Arama desteklemeyen kaynak (teknokent duyuru sayfası gibi): liste
      // sayfası taranır, alaka kapısı sorguya uymayanları eler.
      return [source.baseUrl];
    },
    isDetailUrl: (url) => {
      const host = url.hostname.replace(/^www\./, "");

      if (!sourceHost || (!host.endsWith(sourceHost) && !sourceHost.endsWith(host))) {
        return false;
      }

      if (NON_DETAIL_PATTERN.test(url.pathname)) {
        return false;
      }

      if (/-\d{4,}\/?$/.test(url.pathname)) {
        return true;
      }

      if (!DETAIL_PATH_PATTERN.test(url.pathname)) {
        return false;
      }

      // Kategori sayfası tuzağı: /is-ilanlari/kurye gibi kısa, sayısız son
      // parçalar detay değil kategoridir (ölçüm: İşin Olsun'da tüm bütçe
      // kategori sayfalarına gitti). Gerçek detay slugları ya sayı/uzun kimlik
      // içerir ya da en az üç kelimelik uzun başlık taşır.
      const lastSegment = url.pathname.replace(/\/+$/, "").split("/").pop() ?? "";
      const hasIdentifier = /\d/.test(lastSegment) || /[0-9A-Za-z]{16,}$/.test(lastSegment);
      const wordCount = lastSegment.split("-").filter((word) => word.length > 1).length;

      return hasIdentifier || wordCount >= 3;
    }
  };
}

// ─── Yapılandırılmış kaynaklar (JSON API / RSS) ──────────────────────────

const STRUCTURED_TIMEOUT_MS = 15000;

async function fetchText(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 CVMatchBot/1.0",
      Accept: "application/json,application/rss+xml,text/xml,*/*;q=0.8"
    },
    signal: AbortSignal.timeout(STRUCTURED_TIMEOUT_MS)
  });

  return { status: response.status, body: await response.text() };
}

/** Sorgu terimleriyle en az bir kesişme var mı? (API'ler sorgu almaz; süzme bizde.) */
function matchesQueries(text: string, queryTokens: string[]): boolean {
  if (!queryTokens.length) {
    return true;
  }

  const haystack = normalizeComparable(text);
  return queryTokens.some((token) => haystack.includes(token));
}

export function buildQueryTokens(queries: string[]): string[] {
  const tokens = new Set<string>();

  for (const query of queries) {
    for (const word of normalizeComparable(query).split(" ")) {
      if (word.length >= 3) {
        tokens.add(word);
      }
    }
  }

  return Array.from(tokens);
}

type StructuredOutcome = {
  listings: CrawledJobListing[];
  /** Süzme öncesi kaynaktan okunan toplam kayıt. */
  fetched: number;
  status: number;
};

/** Greenhouse Job Board API: { jobs: [{ title, absolute_url, location, content? }] } */
async function fetchGreenhouse(source: SourceRecord, queryTokens: string[]): Promise<StructuredOutcome> {
  const url = source.baseUrl.includes("?") ? `${source.baseUrl}&content=true` : `${source.baseUrl}?content=true`;
  const { status, body } = await fetchText(url);

  if (status !== 200) {
    return { listings: [], fetched: 0, status };
  }

  const parsed = JSON.parse(body) as { jobs?: Array<Record<string, unknown>> };
  const jobs = parsed.jobs ?? [];
  const company = source.name.replace(/^Greenhouse:\s*/i, "").trim();

  const listings: CrawledJobListing[] = [];

  for (const job of jobs) {
    const title = cleanText(String(job.title ?? ""));
    const jobUrl = String(job.absolute_url ?? "");
    const location = cleanText(String((job.location as { name?: string } | undefined)?.name ?? ""));
    const content = cleanText(String(job.content ?? ""));

    if (!title || !jobUrl) {
      continue;
    }

    if (!matchesQueries(`${title} ${content}`, queryTokens)) {
      continue;
    }

    listings.push({
      platform: source.name,
      category: "tech",
      externalId: job.id != null ? String(job.id) : undefined,
      title,
      company,
      location: location || undefined,
      description: truncateText(content || title),
      url: jobUrl,
      sourceQuery: queryTokens.slice(0, 3).join(" "),
      postedAt: job.updated_at ? String(job.updated_at) : undefined
    });
  }

  return { listings, fetched: jobs.length, status };
}

/** Lever Postings API: [{ text, hostedUrl, categories: { location }, descriptionPlain }] */
async function fetchLever(source: SourceRecord, queryTokens: string[]): Promise<StructuredOutcome> {
  const { status, body } = await fetchText(source.baseUrl);

  if (status !== 200) {
    return { listings: [], fetched: 0, status };
  }

  const jobs = JSON.parse(body) as Array<Record<string, unknown>>;
  const company = source.name.replace(/^Lever:\s*/i, "").trim();
  const listings: CrawledJobListing[] = [];

  for (const job of jobs) {
    const title = cleanText(String(job.text ?? ""));
    const jobUrl = String(job.hostedUrl ?? "");
    const categories = (job.categories ?? {}) as { location?: string; commitment?: string };
    const description = cleanText(String(job.descriptionPlain ?? job.description ?? ""));

    if (!title || !jobUrl) {
      continue;
    }

    if (!matchesQueries(`${title} ${description}`, queryTokens)) {
      continue;
    }

    listings.push({
      platform: source.name,
      category: "tech",
      externalId: job.id != null ? String(job.id) : undefined,
      title,
      company,
      location: categories.location ? cleanText(categories.location) : undefined,
      description: truncateText(description || title),
      url: jobUrl,
      sourceQuery: queryTokens.slice(0, 3).join(" "),
      postedAt: typeof job.createdAt === "number" ? new Date(job.createdAt).toISOString() : undefined
    });
  }

  return { listings, fetched: jobs.length, status };
}

/** RemoteOK API: ilk öğe yasal nottur; kalanlar ilan nesneleridir. */
async function fetchRemoteOk(source: SourceRecord, queryTokens: string[]): Promise<StructuredOutcome> {
  const { status, body } = await fetchText(source.baseUrl.includes("/api") ? source.baseUrl : "https://remoteok.com/api");

  if (status !== 200) {
    return { listings: [], fetched: 0, status };
  }

  const rows = JSON.parse(body) as Array<Record<string, unknown>>;
  const jobs = rows.filter((row) => row && typeof row === "object" && row.position);
  const listings: CrawledJobListing[] = [];

  for (const job of jobs) {
    const title = cleanText(String(job.position ?? ""));
    const jobUrl = String(job.url ?? "");
    const tags = Array.isArray(job.tags) ? job.tags.map((tag) => String(tag)).join(" ") : "";
    const description = cleanText(String(job.description ?? ""));

    if (!title || !jobUrl) {
      continue;
    }

    if (!matchesQueries(`${title} ${tags} ${description.slice(0, 600)}`, queryTokens)) {
      continue;
    }

    listings.push({
      platform: source.name,
      category: "tech",
      externalId: job.id != null ? String(job.id) : undefined,
      title,
      company: job.company ? cleanText(String(job.company)) : undefined,
      location: job.location ? cleanText(String(job.location)) : "Remote",
      workMode: "remote",
      description: truncateText(description || title),
      url: jobUrl,
      sourceQuery: queryTokens.slice(0, 3).join(" "),
      postedAt: job.date ? String(job.date) : undefined
    });
  }

  return { listings, fetched: jobs.length, status };
}

/** RSS beslemesi (WeWorkRemotely biçimi: "Şirket: Pozisyon" başlıkları). */
async function fetchRss(source: SourceRecord, queryTokens: string[]): Promise<StructuredOutcome> {
  const { status, body } = await fetchText(source.searchUrlTemplate ?? source.baseUrl);

  if (status !== 200) {
    return { listings: [], fetched: 0, status };
  }

  const items = body.split(/<item>/i).slice(1);
  const listings: CrawledJobListing[] = [];

  const read = (block: string, tag: string): string => {
    const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    return match ? cleanText(match[1].replace(/<!\[CDATA\[|\]\]>/g, "")) : "";
  };

  for (const item of items) {
    const rawTitle = read(item, "title");
    const link = read(item, "link");
    const description = read(item, "description");

    if (!rawTitle || !link) {
      continue;
    }

    // "Şirket: Pozisyon" → şirket ve unvan ayrılır; ayraç yoksa tamamı unvandır.
    const separator = rawTitle.indexOf(":");
    const company = separator > 0 ? rawTitle.slice(0, separator).trim() : undefined;
    const title = separator > 0 ? rawTitle.slice(separator + 1).trim() : rawTitle;

    if (!matchesQueries(`${title} ${description.slice(0, 600)}`, queryTokens)) {
      continue;
    }

    listings.push({
      platform: source.name,
      category: "tech",
      title,
      company,
      location: read(item, "region") || "Remote",
      workMode: "remote",
      description: truncateText(description || title),
      url: link,
      sourceQuery: queryTokens.slice(0, 3).join(" "),
      postedAt: read(item, "pubDate") || undefined
    });
  }

  return { listings, fetched: items.length, status };
}

/**
 * Yapılandırılmış kaynağı okur. Desteklenmeyen platform tipi hata değil boş
 * sonuç döndürür; sağlık sistemi kaynağı zamanla düşürür.
 */
export async function fetchStructuredSource(
  source: SourceRecord,
  queries: string[]
): Promise<StructuredOutcome> {
  const queryTokens = buildQueryTokens(queries);

  if (source.accessMethod === "rss") {
    return fetchRss(source, queryTokens);
  }

  switch (source.platformType) {
    case "greenhouse":
      return fetchGreenhouse(source, queryTokens);
    case "lever":
      return fetchLever(source, queryTokens);
    case "remoteok-api":
      return fetchRemoteOk(source, queryTokens);
    default:
      console.warn(`[source-adapters] Bilinmeyen yapılandırılmış tip: ${source.platformType} (${source.name})`);
      return { listings: [], fetched: 0, status: 0 };
  }
}

/** Sorgu üretiminde profil bilgisi gerekiyorsa buradan genişletilebilir. */
export function structuredQueryHints(profile: CandidateProfile): string[] {
  return [profile.targetRole, ...(profile.titles ?? []).slice(0, 3), ...(profile.skills ?? []).slice(0, 5)].filter(
    Boolean
  );
}
