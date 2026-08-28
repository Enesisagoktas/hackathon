import mysql from "mysql2/promise";

import { getDbPool } from "@/lib/db";
import { slugify } from "@/lib/jobs/normalize";
import { normalizeCompany } from "@/lib/jobs/dedupe";
import {
  ensureSourceRegistrySchema,
  listSources,
  registerCandidateSource,
  setSourceStatus,
  type SourceRecord
} from "@/lib/jobs/source-registry";

/**
 * Source Discovery — kaynak evrenini büyüten keşif hattı (§2-§3).
 *
 * Akış: keşif → candidate → doğrulama → active. Doğrulanmamış hiçbir kaynak
 * üretim taramasına girmez (selectSourcesForRun yalnızca 'active' okur).
 *
 * Keşif kanalları:
 *  1. ATS yoklaması: cache'teki İLANLARDA GÖRÜLEN şirket adlarından Greenhouse
 *     ve Lever board slug'ları türetilir ve herkese açık API'leri yoklanır.
 *     Şirket, bir ilan sitesinde ilan vermişse kendi ATS'si de olabilir; bu,
 *     tahmin değil gerçek veriden türetilmiş adaylıktır.
 *  2. Şirket kariyer sayfası: aynı şirketlerin {domain}/kariyer benzeri
 *     sayfaları aday olarak kaydedilir; doğrulama ilan sinyali arar.
 *
 * Ölçek: her çalıştırma sınırlı sayıda aday dener (rate-limit dostu);
 * evren zamanla büyür. 1000+ kaynak hedefi tek seferde değil birikimle.
 */

const PROBE_TIMEOUT_MS = 10000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 CVMatchBot/1.0";

async function probe(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json,text/html,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
  });
  return { status: response.status, body: await response.text() };
}

/** Şirket adından ATS slug adayları üretir. */
export function companySlugCandidates(company: string): string[] {
  // normalizeCompany hukuki ekleri, noktaları ve sahte adları zaten temizliyor;
  // burada yalnızca sektör kelimeleri ek olarak atılır.
  const base = slugify(
    normalizeCompany(company)
      .replace(/\b(teknoloji|bilisim|yazilim)\b/g, " ")
      .trim()
  );

  // "A.Ş." gibi içi boş adlar slug üretmemeli: en az üç harflik gerçek bir
  // kelime şartı aranır (test yakaladı: "a-s" geçerli slug sanılıyordu).
  if (!base || !/[a-z]{3,}/.test(base)) {
    return [];
  }

  const compact = base.replace(/-/g, "");
  const candidates = new Set<string>([base, compact]);

  // İlk iki kelime de yaygın bir kalıptır ("dream-games" → "dreamgames").
  const words = base.split("-").filter(Boolean);
  if (words.length > 2) {
    candidates.add(words.slice(0, 2).join("-"));
    candidates.add(words.slice(0, 2).join(""));
  }

  return Array.from(candidates).filter((slug) => slug.length >= 3 && slug.length <= 40);
}

/** Cache'te en çok ilanı görülen şirketler — keşif adaylarının kaynağı. */
export async function topCompaniesFromListings(limit: number): Promise<string[]> {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT company, COUNT(*) n FROM job_listings
     WHERE status = 'active' AND company IS NOT NULL AND CHAR_LENGTH(company) BETWEEN 3 AND 60
     GROUP BY company ORDER BY n DESC LIMIT ?`,
    [limit]
  );
  return rows.map((row) => String(row.company));
}

export type DiscoveryOutcome = {
  probed: number;
  registered: number;
  activated: number;
  failed: number;
  notes: string[];
};

/**
 * ATS keşfi: şirketlerden Greenhouse/Lever board'ları arar.
 *
 * Doğrulama kuralı (§2): API 200 dönmeli VE gerçek ilan içermeli. Boş board
 * candidate olarak bekler (şirket ileride ilan açabilir); hatalı/erişilemeyen
 * aday kaydedilmez.
 */
/**
 * Bilinen Türk teknoloji şirketleri — ATS yoklaması için ipucu listesi.
 *
 * Bunlar tahmin değil gerçek şirketlerdir; hangilerinin Greenhouse/Lever
 * board'u olduğuna YOKLAMA karar verir (404 dönen kaydedilmez). Cache'teki
 * şirketler çoğunlukla ATS kullanmayan KOBİ'ler olduğu için keşif kanalının
 * beslemesi tek başına cache'e bırakılamaz.
 */
const KNOWN_TECH_COMPANIES = [
  "Trendyol", "Getir", "Insider", "Dream Games", "Peak", "Spyke Games",
  "Rollic", "iyzico", "Armut", "Obilet", "Yemeksepeti", "Hepsiburada",
  "Param", "Bitaksi", "Vivense", "Meditopia"
];

export async function discoverAtsSources(options: { maxCompanies?: number; maxProbes?: number } = {}): Promise<DiscoveryOutcome> {
  await ensureSourceRegistrySchema();

  const outcome: DiscoveryOutcome = { probed: 0, registered: 0, activated: 0, failed: 0, notes: [] };
  const fromCache = await topCompaniesFromListings(options.maxCompanies ?? 15);
  // Bilinen teknoloji şirketleri ÖNCE denenir (ATS olasılıkları yüksek);
  // cache şirketleri sonra gelir.
  const companies = Array.from(new Set([...KNOWN_TECH_COMPANIES, ...fromCache]));
  const existing = new Set((await listSources()).map((source) => source.name));
  const maxProbes = options.maxProbes ?? 20;

  for (const company of companies) {
    if (outcome.probed >= maxProbes) {
      break;
    }

    const slugs = companySlugCandidates(company);

    for (const slug of slugs.slice(0, 2)) {
      if (outcome.probed >= maxProbes) {
        break;
      }

      // Greenhouse
      const ghName = `Greenhouse: ${company}`.slice(0, 118);
      if (!existing.has(ghName)) {
        outcome.probed += 1;
        try {
          const gh = await probe(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
          if (gh.status !== 200) {
            outcome.failed += 1;
          }
          if (gh.status === 200) {
            const jobs = (JSON.parse(gh.body) as { jobs?: unknown[] }).jobs ?? [];
            await registerCandidateSource({
              name: ghName,
              baseUrl: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
              sourceType: "ats",
              accessMethod: "json-api",
              platformType: "greenhouse",
              discoveredFrom: `ilan şirketi: ${company}`,
              priority: 45
            });
            outcome.registered += 1;
            existing.add(ghName);

            if (jobs.length > 0) {
              await setSourceStatus(ghName, "active");
              outcome.activated += 1;
              outcome.notes.push(`${ghName}: ${jobs.length} ilan (aktif)`);
            }
            break; // Bu şirket için bulundu; diğer slug denenmez.
          }
        } catch {
          outcome.failed += 1;
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
      }

      // Lever
      const lvName = `Lever: ${company}`.slice(0, 118);
      if (!existing.has(lvName) && outcome.probed < maxProbes) {
        outcome.probed += 1;
        try {
          const lv = await probe(`https://api.lever.co/v0/postings/${slug}?mode=json&limit=3`);
          if (lv.status === 200) {
            const jobs = JSON.parse(lv.body);
            if (Array.isArray(jobs)) {
              await registerCandidateSource({
                name: lvName,
                baseUrl: `https://api.lever.co/v0/postings/${slug}?mode=json`,
                sourceType: "ats",
                accessMethod: "json-api",
                platformType: "lever",
                discoveredFrom: `ilan şirketi: ${company}`,
                priority: 45
              });
              outcome.registered += 1;
              existing.add(lvName);

              if (jobs.length > 0) {
                await setSourceStatus(lvName, "active");
                outcome.activated += 1;
                outcome.notes.push(`${lvName}: ${jobs.length}+ ilan (aktif)`);
              }
              break;
            }
          }
        } catch {
          outcome.failed += 1;
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }
  }

  return outcome;
}

const JOB_PAGE_SIGNALS =
  /(is-ilani|is-ilanlari|\/jobs?\b|\/careers?\b|kariyer|a[çc][ıi]k pozisyon|open position|ba[şs]vur|apply|JobPosting)/i;

const BLOCK_SIGNALS = /(just a moment|attention required|access denied|verify you are|captcha)/i;

/**
 * Candidate kaynakları doğrular: sayfa açılıyor mu, ilan sinyali var mı?
 *
 * Geçen 'active' olur ve rotasyona girer; iki kez üst üste doğrulanamayan
 * 'dead' işaretlenir — üretim sonuçlarına asla karışmaz.
 */
export async function validateCandidateSources(options: { limit?: number } = {}): Promise<DiscoveryOutcome> {
  const outcome: DiscoveryOutcome = { probed: 0, registered: 0, activated: 0, failed: 0, notes: [] };
  const candidates = await listSources("candidate");
  const limit = options.limit ?? 10;

  for (const source of candidates.slice(0, limit)) {
    outcome.probed += 1;

    try {
      const target =
        source.accessMethod === "json-api"
          ? source.baseUrl
          : source.searchUrlTemplate
            ? source.searchUrlTemplate.replace(/\{query(_slug)?\}/g, "test")
            : source.baseUrl;

      const result = await probe(target);

      if (result.status === 200 && !BLOCK_SIGNALS.test(result.body.slice(0, 5000))) {
        const isJson = source.accessMethod === "json-api";
        const hasSignal = isJson
          ? result.body.includes("title") || result.body.includes("jobs")
          : JOB_PAGE_SIGNALS.test(result.body);

        if (hasSignal) {
          await setSourceStatus(source.name, "active");
          outcome.activated += 1;
          outcome.notes.push(`${source.name}: doğrulandı`);
          continue;
        }
      }

      outcome.failed += 1;
      // İlk başarısızlıkta candidate kalır (geçici sorun olabilir); kaynak
      // daha önce de hiç başarılı olmadıysa dead işaretlenir.
      if (source.totalScans > 0 && source.successfulScans === 0) {
        await setSourceStatus(source.name, "dead", `doğrulanamadı (${result.status})`);
        outcome.notes.push(`${source.name}: ölü işaretlendi`);
      }
    } catch (error) {
      outcome.failed += 1;
      outcome.notes.push(`${source.name}: ${(error as Error).message.slice(0, 40)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  return outcome;
}

/** Keşif + doğrulama tek girişte; crawl penceresinin 4. dalgasından da çağrılabilir. */
export async function runDiscoveryCycle(options: { maxProbes?: number } = {}): Promise<DiscoveryOutcome> {
  const ats = await discoverAtsSources({ maxProbes: options.maxProbes ?? 12 });
  const validation = await validateCandidateSources({ limit: 8 });

  return {
    probed: ats.probed + validation.probed,
    registered: ats.registered,
    activated: ats.activated + validation.activated,
    failed: ats.failed + validation.failed,
    notes: [...ats.notes, ...validation.notes]
  };
}
