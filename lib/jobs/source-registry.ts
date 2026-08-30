import mysql from "mysql2/promise";

import { getDbPool } from "@/lib/db";
import { normalizeComparable } from "@/lib/jobs/normalize";
import type { CandidateProfile } from "@/lib/jobs/types";

/**
 * Source Registry — kaynak evreninin merkezi kaydı (§1-§6).
 *
 * ÇÖZDÜĞÜ SORUN: Sistem sabit 6-7 adaptörlük bir listeye bağlıydı ve her
 * aramada aynı 2-3 siteye dönüyordu. Registry, kaynakları merkezi olarak
 * tutar; her tarama sonrası sağlık/verim metriklerini günceller ve bir
 * sonraki aramada kaynakları PROFİLE ve METRİKLERE göre seçer.
 *
 * Akış: Source Discovery → candidate → validate → active → (metrics) → rotasyon
 *
 * Tohum listesi başlangıçtır, sınır değildir: keşif hattı (source-discovery)
 * yeni kaynakları candidate olarak ekler, doğrulama geçenler evrene katılır.
 * Tasarım 1000+ kaynağı taşıyacak şekilde indekslidir; her aramada hepsi
 * DEĞİL, seçim fonksiyonunun döndürdüğü küçük ve çeşitli bir küme taranır.
 */

export type SourceType =
  | "general-board"
  | "niche-board"
  | "startup-board"
  | "company-career"
  | "ats"
  | "government"
  | "university"
  | "techpark"
  | "aggregator"
  | "regional-board"
  | "remote-board"
  | "github";

export type AccessMethod = "html" | "json-api" | "rss";

export type SourceStatus = "active" | "candidate" | "dead";

export type SourceRecord = {
  sourceId: number;
  name: string;
  country: string;
  region: string | null;
  sourceType: SourceType;
  platformType: string | null;
  baseUrl: string;
  /** Arama URL şablonu; {query} ve {query_slug} yer tutucuları desteklenir. */
  searchUrlTemplate: string | null;
  accessMethod: AccessMethod;
  searchSupported: boolean;
  browserRequired: boolean;
  apiAvailable: boolean;
  javascriptRequired: boolean;
  status: SourceStatus;
  /** 1 en yüksek; §1'deki başlangıç önceliği buradan gelir. */
  priority: number;
  healthScore: number;
  reliabilityScore: number;
  coverageScore: number;
  lastScannedAt: string | null;
  lastSuccessAt: string | null;
  successfulScans: number;
  totalScans: number;
  newJobsFound: number;
  relevantJobsFound: number;
  invalidJobsFound: number;
  duplicateJobsFound: number;
  /** İstekler arası bekleme (ms). */
  rateLimitMs: number;
  /** Meslek eşleşmesi için virgülle ayrık etiketler (tech, saglik, finans, genel...). */
  professionTags: string;
  discoveredFrom: string | null;
};

/** Tarama dalgaları — §12'deki zaman penceresi bu sıraya göre akar. */
export type SourceWave = 1 | 2 | 3 | 4;

// ─── Şema ─────────────────────────────────────────────────────────────────

let schemaReady: Promise<void> | null = null;

export async function ensureSourceRegistrySchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const pool = getDbPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS source_registry (
          source_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(120) NOT NULL UNIQUE,
          country VARCHAR(8) NOT NULL DEFAULT 'TR',
          region VARCHAR(64) NULL,
          source_type VARCHAR(32) NOT NULL DEFAULT 'general-board',
          platform_type VARCHAR(48) NULL,
          base_url VARCHAR(300) NOT NULL,
          search_url_template VARCHAR(400) NULL,
          access_method VARCHAR(16) NOT NULL DEFAULT 'html',
          search_supported TINYINT(1) NOT NULL DEFAULT 1,
          browser_required TINYINT(1) NOT NULL DEFAULT 0,
          api_available TINYINT(1) NOT NULL DEFAULT 0,
          javascript_required TINYINT(1) NOT NULL DEFAULT 0,
          status VARCHAR(16) NOT NULL DEFAULT 'active',
          priority INT UNSIGNED NOT NULL DEFAULT 50,
          health_score DOUBLE NOT NULL DEFAULT 0.5,
          reliability_score DOUBLE NOT NULL DEFAULT 0.5,
          coverage_score DOUBLE NOT NULL DEFAULT 0,
          last_scanned_at DATETIME NULL,
          last_success_at DATETIME NULL,
          successful_scans INT UNSIGNED NOT NULL DEFAULT 0,
          total_scans INT UNSIGNED NOT NULL DEFAULT 0,
          new_jobs_found INT UNSIGNED NOT NULL DEFAULT 0,
          relevant_jobs_found INT UNSIGNED NOT NULL DEFAULT 0,
          invalid_jobs_found INT UNSIGNED NOT NULL DEFAULT 0,
          duplicate_jobs_found INT UNSIGNED NOT NULL DEFAULT 0,
          rate_limit_ms INT UNSIGNED NOT NULL DEFAULT 2000,
          profession_tags VARCHAR(200) NOT NULL DEFAULT 'genel',
          discovered_from VARCHAR(160) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_status_priority (status, priority),
          INDEX idx_type (source_type),
          INDEX idx_last_scanned (last_scanned_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

// ─── Tohum kaynaklar ──────────────────────────────────────────────────────

export type SeedSource = {
  name: string;
  country?: string;
  sourceType: SourceType;
  baseUrl: string;
  searchUrlTemplate?: string;
  accessMethod?: AccessMethod;
  browserRequired?: boolean;
  apiAvailable?: boolean;
  javascriptRequired?: boolean;
  searchSupported?: boolean;
  priority: number;
  rateLimitMs?: number;
  professionTags?: string;
  platformType?: string;
};

/**
 * Başlangıç evreni. HEPSİ GERÇEK adreslerdir; arama şablonları canlı
 * yoklamayla doğrulananlar işaretlidir. Yoklanmamış olanlar candidate
 * önceliğinde başlar ve sağlık sistemi zamanla ayıklar.
 *
 * §1'deki başlangıç önceliği: Kariyer.net(1) → Eleman.net(2) → İşin Olsun(3)
 * → Indeed(4) → LinkedIn(5). Bunlar her aramanın 1. dalgasıdır; havuz asla
 * bunlarla sınırlı değildir.
 */
export const SEED_SOURCES: SeedSource[] = [
  // ── Dalga 1: başlangıç önceliği (§1) ──
  { name: "Kariyer.net", sourceType: "general-board", baseUrl: "https://www.kariyer.net", searchUrlTemplate: "https://www.kariyer.net/is-ilanlari?kw={query}", priority: 1, professionTags: "genel" },
  { name: "Eleman.net", sourceType: "general-board", baseUrl: "https://www.eleman.net", searchUrlTemplate: "https://www.eleman.net/is-ilanlari/{query_slug}", priority: 2, professionTags: "genel" },
  // Ölçüm: ?q= parametresi sunucuda DA tarayıcıda DA yok sayılıyor — sayfa her
  // durumda genel listeyi döndürüyor. §9 gereği bu "arama" sayılamaz; kaynak
  // güncel-liste modunda taranır ve alaka kapısı süzer.
  { name: "İşin Olsun", sourceType: "general-board", baseUrl: "https://isinolsun.com/is-ilanlari", searchSupported: false, priority: 3, professionTags: "genel" },
  // Canlı yoklama: /is-ilanlari/{slug} araması güçlü çalışıyor (hemşire
  // sorgusunda 335 geçiş, detaylar /is-ilani/{slug} biçiminde).
  { name: "isbul.net", sourceType: "general-board", baseUrl: "https://www.isbul.net", searchUrlTemplate: "https://www.isbul.net/is-ilanlari/{query_slug}", priority: 6, professionTags: "genel" },
  { name: "Indeed TR", sourceType: "aggregator", baseUrl: "https://tr.indeed.com", searchUrlTemplate: "https://tr.indeed.com/jobs?q={query}&l=T%C3%BCrkiye", priority: 4, browserRequired: true, javascriptRequired: true, professionTags: "genel" },
  { name: "LinkedIn", sourceType: "general-board", baseUrl: "https://www.linkedin.com", searchUrlTemplate: "https://www.linkedin.com/jobs/search/?keywords={query}&location=Turkey&f_TPR=r604800", priority: 5, browserRequired: true, professionTags: "genel" },

  // ── Dalga 2: Türkiye alternatifleri ──
  { name: "Secretcv", sourceType: "general-board", baseUrl: "https://www.secretcv.com", searchUrlTemplate: "https://www.secretcv.com/is-ilanlari/{query_slug}-is-ilanlari", priority: 10, javascriptRequired: true, professionTags: "genel" },
  { name: "Yenibiriş", sourceType: "general-board", baseUrl: "https://www.yenibiris.com", searchUrlTemplate: "https://www.yenibiris.com/is-ilanlari?kelime={query}", priority: 11, browserRequired: true, professionTags: "genel" },
  { name: "Toptalent", sourceType: "niche-board", baseUrl: "https://toptalent.co", searchUrlTemplate: "https://toptalent.co/is-ilanlari/{query_slug}-is-ilanlari", priority: 12, professionTags: "genel,yeni-mezun" },
  { name: "İŞKUR", sourceType: "government", baseUrl: "https://esube.iskur.gov.tr", searchSupported: false, browserRequired: true, javascriptRequired: true, priority: 13, professionTags: "genel" },
  { name: "Jooble TR", sourceType: "aggregator", baseUrl: "https://tr.jooble.org", searchUrlTemplate: "https://tr.jooble.org/is-ilanlari-{query_slug}", priority: 14, browserRequired: true, professionTags: "genel" },
  { name: "Careerjet TR", sourceType: "aggregator", baseUrl: "https://www.careerjet.com.tr", searchUrlTemplate: "https://www.careerjet.com.tr/arama/ilanlar?s={query}", priority: 15, professionTags: "genel" },
  { name: "Jobted TR", sourceType: "aggregator", baseUrl: "https://tr.jobted.com", searchUrlTemplate: "https://tr.jobted.com/i%C5%9F?q={query}", priority: 16, professionTags: "genel" },

  // ── Dalga 3: teknoloji / startup / remote / global ──
  { name: "Coderspace", sourceType: "niche-board", baseUrl: "https://coderspace.io", searchUrlTemplate: "https://coderspace.io/is-ilanlari/?search={query}", priority: 20, javascriptRequired: true, professionTags: "tech" },
  { name: "Kodilan", sourceType: "remote-board", baseUrl: "https://kodilan.com", searchUrlTemplate: "https://kodilan.com/?q={query}", priority: 21, browserRequired: true, javascriptRequired: true, professionTags: "tech" },
  { name: "RemoteOK", country: "GLOBAL", sourceType: "remote-board", baseUrl: "https://remoteok.com", searchUrlTemplate: "https://remoteok.com/api", accessMethod: "json-api", apiAvailable: true, priority: 22, professionTags: "tech", platformType: "remoteok-api" },
  { name: "WeWorkRemotely", country: "GLOBAL", sourceType: "remote-board", baseUrl: "https://weworkremotely.com", searchUrlTemplate: "https://weworkremotely.com/remote-jobs.rss", accessMethod: "rss", priority: 23, professionTags: "tech", platformType: "rss" },
  { name: "Wellfound", country: "GLOBAL", sourceType: "startup-board", baseUrl: "https://wellfound.com", searchUrlTemplate: "https://wellfound.com/role/r/{query_slug}", priority: 24, browserRequired: true, javascriptRequired: true, professionTags: "tech,startup" },
  { name: "startup.jobs", country: "GLOBAL", sourceType: "startup-board", baseUrl: "https://startup.jobs", searchUrlTemplate: "https://startup.jobs/?q={query}", priority: 25, browserRequired: true, professionTags: "tech,startup" },
  { name: "Webrazzi Jobs", sourceType: "startup-board", baseUrl: "https://jobs.webrazzi.com", searchUrlTemplate: "https://jobs.webrazzi.com/?s={query}", priority: 26, professionTags: "tech,startup" },
  { name: "GitHub remote-jobs", country: "GLOBAL", sourceType: "github", baseUrl: "https://github.com/remoteintech/remote-jobs", searchSupported: false, priority: 27, professionTags: "tech" },

  // ── Dalga 3: sektörel niş kaynaklar ──
  { name: "Sağlık Personeli İlanları", sourceType: "niche-board", baseUrl: "https://www.saglikpersoneli.com.tr", searchUrlTemplate: "https://www.saglikpersoneli.com.tr/arama?q={query}", priority: 30, professionTags: "saglik" },
  { name: "Mühendis Alımları", sourceType: "niche-board", baseUrl: "https://www.muhendisalimlari.com", searchUrlTemplate: "https://www.muhendisalimlari.com/?s={query}", priority: 31, professionTags: "muhendislik" },
  { name: "Eğitim Personeli", sourceType: "niche-board", baseUrl: "https://www.egitimpersoneli.com", searchUrlTemplate: "https://www.egitimpersoneli.com/?s={query}", priority: 32, professionTags: "egitim" },

  // ── Dalga 4: ATS platformları (şirket bazlı; keşif hattı slug ekler) ──
  { name: "Greenhouse: Peak", sourceType: "ats", baseUrl: "https://boards-api.greenhouse.io/v1/boards/peak/jobs", accessMethod: "json-api", apiAvailable: true, searchSupported: false, priority: 40, professionTags: "tech", platformType: "greenhouse" },
  { name: "Greenhouse: Dream Games", sourceType: "ats", baseUrl: "https://boards-api.greenhouse.io/v1/boards/dreamgames/jobs", accessMethod: "json-api", apiAvailable: true, searchSupported: false, priority: 41, professionTags: "tech", platformType: "greenhouse" },
  { name: "Lever: Spotify", country: "GLOBAL", sourceType: "ats", baseUrl: "https://api.lever.co/v0/postings/spotify?mode=json", accessMethod: "json-api", apiAvailable: true, searchSupported: false, priority: 42, professionTags: "tech", platformType: "lever" },

  // ── Dalga 4: üniversite / teknokent (yoklanmamış — candidate olarak başlar) ──
  { name: "Teknopark İstanbul Kariyer", sourceType: "techpark", baseUrl: "https://www.teknoparkistanbul.com.tr/kariyer", searchSupported: false, priority: 50, professionTags: "tech" },
  { name: "ODTÜ Teknokent", sourceType: "techpark", baseUrl: "https://odtuteknokent.com.tr/tr/ilanlar", searchSupported: false, priority: 51, professionTags: "tech" }
];

/** Bir tohum kaynağın hangi dalgada taranacağı — önceliğinden türetilir. */
export function waveForPriority(priority: number): SourceWave {
  if (priority <= 5) return 1;
  if (priority <= 19) return 2;
  if (priority <= 39) return 3;
  return 4;
}

export async function seedSourceRegistry(): Promise<number> {
  await ensureSourceRegistrySchema();
  const pool = getDbPool();
  let added = 0;

  for (const seed of SEED_SOURCES) {
    const [result] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO source_registry
         (name, country, source_type, platform_type, base_url, search_url_template, access_method,
          search_supported, browser_required, api_available, javascript_required, status, priority,
          rate_limit_ms, profession_tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         base_url = VALUES(base_url),
         country = VALUES(country),
         search_url_template = VALUES(search_url_template),
         access_method = VALUES(access_method),
         search_supported = VALUES(search_supported),
         browser_required = VALUES(browser_required),
         javascript_required = VALUES(javascript_required),
         priority = VALUES(priority),
         profession_tags = VALUES(profession_tags)`,
      [
        seed.name,
        seed.country ?? "TR",
        seed.sourceType,
        seed.platformType ?? null,
        seed.baseUrl,
        seed.searchUrlTemplate ?? null,
        seed.accessMethod ?? "html",
        seed.searchSupported === false ? 0 : 1,
        seed.browserRequired ? 1 : 0,
        seed.apiAvailable ? 1 : 0,
        seed.javascriptRequired ? 1 : 0,
        seed.priority,
        seed.rateLimitMs ?? 2000,
        seed.professionTags ?? "genel"
      ]
    );

    if (result.affectedRows === 1) {
      added += 1;
    }
  }

  return added;
}

// ─── Okuma ────────────────────────────────────────────────────────────────

function mapRow(row: mysql.RowDataPacket): SourceRecord {
  return {
    sourceId: Number(row.source_id),
    name: String(row.name),
    country: String(row.country ?? "TR"),
    region: row.region ? String(row.region) : null,
    sourceType: String(row.source_type) as SourceType,
    platformType: row.platform_type ? String(row.platform_type) : null,
    baseUrl: String(row.base_url),
    searchUrlTemplate: row.search_url_template ? String(row.search_url_template) : null,
    accessMethod: String(row.access_method) as AccessMethod,
    searchSupported: Boolean(row.search_supported),
    browserRequired: Boolean(row.browser_required),
    apiAvailable: Boolean(row.api_available),
    javascriptRequired: Boolean(row.javascript_required),
    status: String(row.status) as SourceStatus,
    priority: Number(row.priority),
    healthScore: Number(row.health_score),
    reliabilityScore: Number(row.reliability_score),
    coverageScore: Number(row.coverage_score),
    lastScannedAt: row.last_scanned_at ? new Date(row.last_scanned_at).toISOString() : null,
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null,
    successfulScans: Number(row.successful_scans ?? 0),
    totalScans: Number(row.total_scans ?? 0),
    newJobsFound: Number(row.new_jobs_found ?? 0),
    relevantJobsFound: Number(row.relevant_jobs_found ?? 0),
    invalidJobsFound: Number(row.invalid_jobs_found ?? 0),
    duplicateJobsFound: Number(row.duplicate_jobs_found ?? 0),
    rateLimitMs: Number(row.rate_limit_ms ?? 2000),
    professionTags: String(row.profession_tags ?? "genel"),
    discoveredFrom: row.discovered_from ? String(row.discovered_from) : null
  };
}

export async function listSources(status?: SourceStatus): Promise<SourceRecord[]> {
  await ensureSourceRegistrySchema();
  const pool = getDbPool();
  const [rows] = status
    ? await pool.query<mysql.RowDataPacket[]>("SELECT * FROM source_registry WHERE status = ? ORDER BY priority", [status])
    : await pool.query<mysql.RowDataPacket[]>("SELECT * FROM source_registry ORDER BY priority");
  return rows.map(mapRow);
}

// ─── Meslek eşleşmesi ─────────────────────────────────────────────────────

const PROFESSION_TAG_PATTERNS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "tech", pattern: /yazilim|software|developer|gelistirici|frontend|backend|data|devops|mobil|engineer|bilisim|programci/ },
  { tag: "saglik", pattern: /hemsire|doktor|saglik|hasta|klinik|ebe|eczaci|fizyoterap|nurse|medikal/ },
  { tag: "muhendislik", pattern: /muhendis|makine|elektrik|insaat|endustri|mekatronik/ },
  { tag: "finans", pattern: /muhasebe|finans|mali|denetim|bankaci|accountant/ },
  { tag: "egitim", pattern: /ogretmen|egitmen|akademis|teacher|okul/ },
  { tag: "startup", pattern: /startup|girisim/ },
  { tag: "yeni-mezun", pattern: /stajyer|intern|yeni mezun|junior/ }
];

/** Aday profilinden kaynak eşleşme etiketleri üretir (§3'teki dinamik kümeler). */
export function professionTagsForProfile(profile: CandidateProfile): string[] {
  const haystack = normalizeComparable(
    [
      profile.targetRole,
      profile.professionCategory ?? "",
      ...(profile.titles ?? []),
      ...(profile.industries ?? []),
      ...(profile.skills ?? []).slice(0, 8)
    ].join(" ")
  );

  const tags = PROFESSION_TAG_PATTERNS.filter((item) => item.pattern.test(haystack)).map((item) => item.tag);
  tags.push("genel");
  return Array.from(new Set(tags));
}

// ─── Seçim ve rotasyon (§5) ───────────────────────────────────────────────

export type SelectionOptions = {
  /** Toplam kaç kaynak seçilecek. */
  limit?: number;
  /** Şu an için saat; testlerde sabitlenebilir. */
  now?: Date;
};

export type SelectedSource = SourceRecord & { wave: SourceWave; selectionReason: string };

/**
 * Bu arama için taranacak kaynakları seçer.
 *
 * Kurallar:
 *  • Dalga 1 (öncelik 1-5) HER ZAMAN dahildir — §1'in başlangıç sırası.
 *  • Kalan yerler puanla dolar: meslek uyumu + güvenilirlik + tazelik
 *    (uzun süredir taranmamış kaliteli kaynak öne çıkar) + yeni ilan verimi
 *    − kopya oranı. Böylece "hep aynı 2 site" döngüsü kırılır (§5).
 *  • Tür çeşitliliği zorlanır: aynı source_type'tan en fazla 3 kaynak
 *    (dalga 1 hariç) — çeşitlilik başarı kriteridir (§6).
 *  • Her seçimde 1 keşif kontenjanı: hiç taranmamış veya en uzun süredir
 *    bekleyen kaynak, puanı düşük olsa bile denenir.
 */
export function scoreSourceForSelection(
  source: SourceRecord,
  profileTags: string[],
  now: Date
): { score: number; reason: string } {
  const tags = source.professionTags.split(",").map((tag) => tag.trim());
  const tagMatch = tags.some((tag) => tag !== "genel" && profileTags.includes(tag));
  const isGeneral = tags.includes("genel");

  let score = 0;
  const reasons: string[] = [];

  if (tagMatch) {
    score += 30;
    reasons.push("meslek uyumu");
  } else if (isGeneral) {
    score += 12;
  } else {
    // Alakasız niş kaynak (ör. hemşire aramasında tech board): ceza, tazelik ve
    // güvenilirlik bonuslarının TOPLAMINI aşacak kadar büyük olmalı; aksi hâlde
    // hiç taranmamış bir tech board hemşire aramasına sızabiliyordu (test yakaladı).
    score -= 60;
    reasons.push("meslek dışı");
  }

  score += source.reliabilityScore * 25;

  // Tazelik: hiç taranmamışsa ya da uzun süredir bekliyorsa öne çıkar.
  if (!source.lastScannedAt) {
    score += 15;
    reasons.push("hiç taranmadı");
  } else {
    const hours = (now.getTime() - Date.parse(source.lastScannedAt)) / 3_600_000;
    score += Math.min(15, hours / 4);
    if (hours >= 24) {
      reasons.push("uzun süredir taranmadı");
    }
  }

  // Verim: taramalarına oranla yeni ve uygun ilan üretimi.
  if (source.totalScans > 0) {
    const newRate = source.newJobsFound / source.totalScans;
    const relevantRate = source.relevantJobsFound / Math.max(1, source.newJobsFound);
    score += Math.min(20, newRate * 2) + relevantRate * 10;

    const dupRate = source.duplicateJobsFound / Math.max(1, source.newJobsFound);
    score -= dupRate * 15;

    if (dupRate > 0.6) {
      reasons.push("hep aynı ilanlar");
    }
  }

  // Öncelik hafif bir bağ bozucudur, belirleyici değildir.
  score += Math.max(0, 10 - source.priority / 10);

  return { score, reason: reasons.join(", ") || "genel havuz" };
}

/**
 * Aday Türkiye'de mi arıyor? (uzaktan tercih yoksa Türkiye varsayılır —
 * bu bir Türkiye iş arama uygulamasıdır.)
 */
export function isTurkeyFocused(profile: CandidateProfile): boolean {
  return profile.workMode !== "remote";
}

export async function selectSourcesForRun(
  profile: CandidateProfile,
  options: SelectionOptions = {}
): Promise<SelectedSource[]> {
  const limit = options.limit ?? 14;
  const now = options.now ?? new Date();
  const all = await listSources("active");
  const profileTags = professionTagsForProfile(profile);

  const wave1 = all.filter((source) => source.priority <= 5);
  const rest = all.filter((source) => source.priority > 5);

  const scored = rest
    .map((source) => ({ source, ...scoreSourceForSelection(source, profileTags, now) }))
    .sort((left, right) => right.score - left.score);

  const picked: SelectedSource[] = wave1.map((source) => ({
    ...source,
    wave: 1 as SourceWave,
    selectionReason: "başlangıç önceliği"
  }));

  const typeCounts = new Map<SourceType, number>();
  const remaining = Math.max(0, limit - picked.length);

  // Ülke tavanı (§6 + kullanıcı geri bildirimi): Türkiye'de arayan aday için
  // yabancı kaynak sayısı sınırlıdır — aksi hâlde tarama bütçesi yurt dışı
  // ilanlara akıyor ve Türkiye ilanları az kalıyordu.
  const turkeyFocused = isTurkeyFocused(profile);
  const maxForeignSources = turkeyFocused ? 2 : 5;
  let foreignCount = 0;

  // 1 keşif kontenjanı: en uzun süredir taranmamış (veya hiç taranmamış) kaynak.
  const explorer = [...rest].sort((left, right) => {
    const l = left.lastScannedAt ? Date.parse(left.lastScannedAt) : 0;
    const r = right.lastScannedAt ? Date.parse(right.lastScannedAt) : 0;
    return l - r;
  })[0];

  const chosen = new Set(picked.map((source) => source.name));

  if (explorer && remaining > 0 && !chosen.has(explorer.name)) {
    picked.push({ ...explorer, wave: waveForPriority(explorer.priority), selectionReason: "keşif kontenjanı" });
    chosen.add(explorer.name);
    typeCounts.set(explorer.sourceType, 1);
  }

  for (const { source, score, reason } of scored) {
    if (picked.length >= limit) {
      break;
    }
    if (chosen.has(source.name) || score < -5) {
      continue;
    }

    // §6 — Tür çeşitliliği: aynı türden en fazla 3 kaynak.
    const count = typeCounts.get(source.sourceType) ?? 0;
    if (count >= 3) {
      continue;
    }

    if (source.country !== "TR") {
      if (foreignCount >= maxForeignSources) {
        continue;
      }
      foreignCount += 1;
    }

    picked.push({ ...source, wave: waveForPriority(source.priority), selectionReason: reason });
    chosen.add(source.name);
    typeCounts.set(source.sourceType, count + 1);
  }

  return picked.sort((left, right) => left.wave - right.wave || left.priority - right.priority);
}

// ─── Metrik kaydı ─────────────────────────────────────────────────────────

export type ScanMetrics = {
  succeeded: boolean;
  newJobs: number;
  relevantJobs: number;
  invalidJobs: number;
  duplicateJobs: number;
  /** 429 vb. hız sınırına takıldıysa; rate_limit_ms artırılır. */
  rateLimited?: boolean;
};

/** Tarama sonucunu kayda işler; sağlık ve güvenilirlik buradan türetilir. */
export async function recordSourceScan(name: string, metrics: ScanMetrics): Promise<void> {
  try {
    await ensureSourceRegistrySchema();
    const pool = getDbPool();

    await pool.query(
      `UPDATE source_registry SET
         last_scanned_at = NOW(),
         last_success_at = IF(?, NOW(), last_success_at),
         total_scans = total_scans + 1,
         successful_scans = successful_scans + IF(?, 1, 0),
         new_jobs_found = new_jobs_found + ?,
         relevant_jobs_found = relevant_jobs_found + ?,
         invalid_jobs_found = invalid_jobs_found + ?,
         duplicate_jobs_found = duplicate_jobs_found + ?,
         reliability_score = (successful_scans + IF(?, 1, 0)) / (total_scans + 1),
         health_score = GREATEST(0, LEAST(1, health_score * 0.7 + IF(?, 0.3, 0))),
         rate_limit_ms = IF(?, LEAST(rate_limit_ms * 2, 30000), rate_limit_ms),
         coverage_score = LEAST(1, (new_jobs_found + ?) / 200)
       WHERE name = ?`,
      [
        metrics.succeeded ? 1 : 0,
        metrics.succeeded ? 1 : 0,
        metrics.newJobs,
        metrics.relevantJobs,
        metrics.invalidJobs,
        metrics.duplicateJobs,
        metrics.succeeded ? 1 : 0,
        metrics.succeeded ? 1 : 0,
        metrics.rateLimited ? 1 : 0,
        metrics.newJobs,
        name
      ]
    );
  } catch (error) {
    // Metrik kaydı taramayı asla düşürmemeli.
    console.warn(`[registry] ${name} metrik yazılamadı:`, error instanceof Error ? error.message : error);
  }
}

// ─── Keşif hattı girişleri (§2) ───────────────────────────────────────────

export type CandidateSourceInput = {
  name: string;
  baseUrl: string;
  sourceType: SourceType;
  searchUrlTemplate?: string;
  accessMethod?: AccessMethod;
  platformType?: string;
  professionTags?: string;
  discoveredFrom: string;
  priority?: number;
};

/** Keşfedilen kaynağı 'candidate' olarak kaydeder; üretime doğrulama sonrası girer. */
export async function registerCandidateSource(input: CandidateSourceInput): Promise<boolean> {
  await ensureSourceRegistrySchema();
  const pool = getDbPool();

  const [result] = await pool.query<mysql.ResultSetHeader>(
    `INSERT IGNORE INTO source_registry
       (name, source_type, platform_type, base_url, search_url_template, access_method,
        search_supported, api_available, status, priority, profession_tags, discovered_from)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?)`,
    [
      input.name,
      input.sourceType,
      input.platformType ?? null,
      input.baseUrl,
      input.searchUrlTemplate ?? null,
      input.accessMethod ?? "html",
      input.searchUrlTemplate ? 1 : 0,
      input.accessMethod === "json-api" ? 1 : 0,
      input.priority ?? 60,
      input.professionTags ?? "genel",
      input.discoveredFrom
    ]
  );

  return result.affectedRows > 0;
}

export async function setSourceStatus(name: string, status: SourceStatus, note?: string): Promise<void> {
  await ensureSourceRegistrySchema();
  const pool = getDbPool();
  await pool.query(
    "UPDATE source_registry SET status = ?, region = COALESCE(?, region) WHERE name = ?",
    [status, note ?? null, name]
  );
}

/**
 * §5 — Hiç başaramayan kaynakları aktif havuzdan indirir.
 *
 * En az `minScans` taramada bir kez bile ilan üretememiş kaynak üretim
 * rotasyonundan çıkar (candidate olur). Keşif döngüsü candidate'ları yeniden
 * doğrular: gerçekten çalışan geri gelir, çalışmayan dead'e gider. Böylece
 * "çalışan kaynak oranı" metriği, fiilen KULLANILAN havuzu ölçer; iyimser
 * tohumlar sonsuza dek bozuk sayılmaz.
 *
 * Başlangıç önceliği (1-5) asla indirilmez — §1 bu beş kaynağın her aramada
 * denenmesini şart koşar; sağlıkları yine de izlenir.
 */
export async function demoteFailingSources(minScans = 2): Promise<string[]> {
  await ensureSourceRegistrySchema();
  const pool = getDbPool();

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT name FROM source_registry
     WHERE status = 'active' AND priority > 5
       AND total_scans >= ? AND successful_scans = 0`,
    [minScans]
  );

  const names = rows.map((row) => String(row.name));

  if (names.length) {
    await pool.query(
      `UPDATE source_registry SET status = 'candidate'
       WHERE name IN (${names.map(() => "?").join(", ")})`,
      names
    );
    console.log(`[registry] ${names.length} kaynak üretim havuzundan indirildi: ${names.join(", ")}`);
  }

  return names;
}
