import { createHash } from "crypto";

import mysql from "mysql2/promise";

import { getDbPool } from "@/lib/db";
import { parseJsonField } from "@/lib/job-queue";
import { normalizeWorkMode, type WorkMode } from "@/lib/search-preferences";
import type {
  CandidateProfile,
  JobListingRecord,
  JobListingStatus,
  JobResultCategory
} from "@/lib/jobs/types";

const SOURCE_CATEGORIES = new Set<JobResultCategory>(["general", "tech", "public"]);
const BROAD_LIMIT = 150;
const TOPUP_LIMIT = 30;

export type JobSourceRow = mysql.RowDataPacket & {
  id: number;
  name: string;
  base_url: string;
  category: JobResultCategory;
  is_active: number;
};

export type UpsertListingInput = {
  sourceName: string;
  sourceBaseUrl?: string;
  sourceCategory?: JobResultCategory;
  externalId?: string;
  title: string;
  company?: string;
  location?: string;
  workMode?: WorkMode | null;
  description?: string;
  requirements?: string[];
  candidateCriteria?: string[];
  postedAt?: string | Date | null;
  expiresAt?: string | Date | null;
  sourceQuery?: string;
  externalUrl: string;
  rawJson?: unknown;
  parseStatus?: "parsed" | "summary_only" | "failed";
  /** When true, last_checked_at is set to NOW() (a detail page was actually fetched). */
  markChecked?: boolean;
};

// ─── Sources ─────────────────────────────────────────────────────────────

export async function getActiveSources(): Promise<JobSourceRow[]> {
  const pool = getDbPool();
  const [rows] = await pool.query<JobSourceRow[]>(
    "SELECT id, name, base_url, category, is_active FROM job_sources WHERE is_active = TRUE ORDER BY id"
  );
  return rows;
}

export async function getSourceByName(name: string): Promise<JobSourceRow | null> {
  const pool = getDbPool();
  const [rows] = await pool.query<JobSourceRow[]>(
    "SELECT id, name, base_url, category, is_active FROM job_sources WHERE name = ? LIMIT 1",
    [name]
  );
  return rows[0] ?? null;
}

export async function getOrCreateSourceId(
  name: string,
  baseUrl: string,
  category: JobResultCategory
): Promise<number> {
  const safeCategory = SOURCE_CATEGORIES.has(category) ? category : "general";
  const pool = getDbPool();

  const existing = await getSourceByName(name);
  if (existing) {
    return existing.id;
  }

  const [result] = await pool.query<mysql.ResultSetHeader>(
    `INSERT INTO job_sources (name, base_url, category, is_active)
     VALUES (?, ?, ?, TRUE)
     ON DUPLICATE KEY UPDATE base_url = VALUES(base_url), category = VALUES(category), is_active = TRUE, updated_at = NOW()`,
    [name, baseUrl || deriveBaseUrl(name), safeCategory]
  );

  if (result.insertId) {
    return result.insertId;
  }

  const created = await getSourceByName(name);
  if (!created) {
    throw new Error(`Kaynak oluşturulamadı: ${name}`);
  }
  return created.id;
}

// ─── Listings: write ──────────────────────────────────────────────────────

export async function upsertJobListing(input: UpsertListingInput): Promise<void> {
  const pool = getDbPool();
  const sourceId = await getOrCreateSourceId(
    input.sourceName,
    input.sourceBaseUrl ?? "",
    input.sourceCategory ?? "general"
  );

  const description = (input.description ?? "").slice(0, 60000);
  const requirements = (input.requirements ?? []).filter(Boolean).slice(0, 30);
  const candidateCriteria = (input.candidateCriteria ?? []).filter(Boolean).slice(0, 30);
  const contentHash = hashContent([input.title, input.company ?? "", description, requirements.join("|")].join("::"));
  const workMode = input.workMode && input.workMode !== "any" ? input.workMode : null;
  const parseStatus = input.parseStatus ?? "parsed";
  const checkedAt = input.markChecked ? new Date() : null;

  await pool.query(
    `INSERT INTO job_listings
       (source_id, external_id, title, company, location, work_mode, description,
        requirements, candidate_criteria, posted_at, expires_at, source_query,
        external_url, content_hash, raw_json, parse_status, status, error_count,
        first_seen_at, last_seen_at, last_checked_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0,
        NOW(), NOW(), ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
        external_id = VALUES(external_id),
        title = VALUES(title),
        company = VALUES(company),
        location = VALUES(location),
        work_mode = VALUES(work_mode),
        description = VALUES(description),
        requirements = VALUES(requirements),
        candidate_criteria = VALUES(candidate_criteria),
        posted_at = COALESCE(VALUES(posted_at), posted_at),
        expires_at = COALESCE(VALUES(expires_at), expires_at),
        source_query = COALESCE(VALUES(source_query), source_query),
        content_hash = VALUES(content_hash),
        raw_json = VALUES(raw_json),
        parse_status = VALUES(parse_status),
        status = 'active',
        error_count = 0,
        last_seen_at = NOW(),
        last_checked_at = COALESCE(VALUES(last_checked_at), last_checked_at),
        updated_at = NOW()`,
    [
      sourceId,
      input.externalId ?? null,
      input.title.slice(0, 255),
      input.company?.slice(0, 190) ?? null,
      input.location?.slice(0, 190) ?? null,
      workMode,
      description,
      JSON.stringify(requirements),
      JSON.stringify(candidateCriteria),
      toMysqlDate(input.postedAt),
      toMysqlDate(input.expiresAt),
      input.sourceQuery?.slice(0, 255) ?? null,
      input.externalUrl.slice(0, 700),
      contentHash,
      input.rawJson != null ? JSON.stringify(input.rawJson) : null,
      parseStatus,
      checkedAt
    ]
  );
}

export async function markListingActive(id: number): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    "UPDATE job_listings SET status = 'active', error_count = 0, last_checked_at = NOW(), last_seen_at = NOW(), updated_at = NOW() WHERE id = ?",
    [id]
  );
}

export async function markListingStale(id: number, reason?: string): Promise<void> {
  await setStatus(id, "stale", reason);
}

export async function markListingExpired(id: number, reason?: string): Promise<void> {
  await setStatus(id, "expired", reason);

  // İlan kapandıysa ona ait BEKLEYEN başvuru paketleri de anlamını yitirir.
  // Eskiden yalnızca ilan 'expired' oluyordu; paket "Elle başvuru" olarak
  // listede kalmaya devam ediyor ve kullanıcı kapanmış bir ilana zaman
  // harcıyordu. Gönderilmiş başvurular geçmiş kaydı olarak korunur.
  const pool = getDbPool();
  const [result] = await pool.query<mysql.ResultSetHeader>(
    `UPDATE job_applications
     SET status = 'skipped',
         error_message = 'İlan yayından kalktı.',
         updated_at = NOW()
     WHERE listing_id = ? AND status IN ('needs_review', 'manual_required', 'queued', 'preparing')`,
    [id]
  );

  if (result.affectedRows) {
    console.log(`[repository] İlan ${id} kapandı; ${result.affectedRows} bekleyen başvuru paketi kapatıldı.`);
  }
}

export async function incrementListingError(id: number, reason?: string): Promise<void> {
  const pool = getDbPool();
  // Bump the error counter; escalate to 'stale' once it reaches the threshold.
  await pool.query(
    `UPDATE job_listings
     SET error_count = error_count + 1,
         status = IF(error_count + 1 >= 3 AND status = 'active', 'stale', status),
         last_checked_at = NOW(),
         updated_at = NOW()
     WHERE id = ?`,
    [id]
  );
  if (reason) {
    logListingNote(id, reason);
  }
}

async function setStatus(id: number, status: JobListingStatus, reason?: string): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    "UPDATE job_listings SET status = ?, last_checked_at = NOW(), updated_at = NOW() WHERE id = ?",
    [status, id]
  );
  if (reason) {
    logListingNote(id, reason);
  }
}

// ─── Listings: read ─────────────────────────────────────────────────────

/**
 * Broad candidate fetch from the DB cache. Never calls the live crawler.
 * 1) FULLTEXT match on the candidate's terms.
 * 2) LIKE fallback for the strongest terms.
 * 3) Top-up with the most recently seen active listings so the demo is never empty.
 */
export async function searchActiveListings(profile: CandidateProfile): Promise<JobListingRecord[]> {
  const pool = getDbPool();
  const byId = new Map<number, JobListingRecord>();

  const fulltextQuery = buildFulltextQuery(profile);
  if (fulltextQuery) {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `${BASE_SELECT}
       WHERE l.status = 'active'
         AND MATCH(l.title, l.company, l.description) AGAINST (? IN NATURAL LANGUAGE MODE)
       ORDER BY l.last_seen_at DESC
       LIMIT ?`,
      [fulltextQuery, BROAD_LIMIT]
    );
    collect(byId, rows);
  }

  if (byId.size < BROAD_LIMIT) {
    const likeTerms = buildLikeTerms(profile);
    if (likeTerms.length) {
      const clause = likeTerms.map(() => "(l.title LIKE ? OR l.description LIKE ? OR l.company LIKE ?)").join(" OR ");
      const params: string[] = [];
      for (const term of likeTerms) {
        const wildcard = `%${term}%`;
        params.push(wildcard, wildcard, wildcard);
      }
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `${BASE_SELECT}
         WHERE l.status = 'active' AND (${clause})
         ORDER BY l.last_seen_at DESC
         LIMIT ?`,
        [...params, BROAD_LIMIT]
      );
      collect(byId, rows);
    }
  }

  // Profil terimleri HİÇBİR ilanla eşleşmediyse AI'nın değerlendirmesi için
  // küçük bir güncel havuz verilir; AI alakasızları zaten 0-15 puanla eler.
  // Eskiden bu dolgu "en az 15 aday" garantisiyle her aramada çalışıyordu ve
  // hemşire CV'sine ofis ilanları buradan sızıyordu.
  if (byId.size === 0) {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `${BASE_SELECT}
       WHERE l.status = 'active'
       ORDER BY l.last_seen_at DESC
       LIMIT ?`,
      [TOPUP_LIMIT]
    );
    collect(byId, rows);
  }

  return Array.from(byId.values()).slice(0, BROAD_LIMIT);
}

export async function getListingsForVerification(limit = 50): Promise<JobListingRecord[]> {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `${BASE_SELECT}
     WHERE l.status IN ('active', 'stale')
     ORDER BY (l.last_checked_at IS NULL) DESC, l.last_checked_at ASC
     LIMIT ?`,
    [Math.max(1, Math.min(500, limit))]
  );
  return rows.map(mapListingRow);
}

export async function countActiveListings(): Promise<number> {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS count FROM job_listings WHERE status = 'active'"
  );
  return Number(rows[0]?.count ?? 0);
}

// ─── Sample import ─────────────────────────────────────────────────────────

export type SampleJob = {
  platform: string;
  baseUrl?: string;
  category?: JobResultCategory;
  externalId?: string;
  title: string;
  company?: string;
  location?: string;
  workMode?: WorkMode | string | null;
  description?: string;
  requirements?: string[];
  candidateCriteria?: string[];
  url: string;
  postedAt?: string;
  sourceQuery?: string;
};

export async function importSampleJobs(jobs: SampleJob[]): Promise<number> {
  let imported = 0;
  for (const job of jobs) {
    if (!job.title || !job.url) {
      continue;
    }
    await upsertJobListing({
      sourceName: job.platform,
      sourceBaseUrl: job.baseUrl,
      sourceCategory: job.category ?? "general",
      externalId: job.externalId,
      title: job.title,
      company: job.company,
      location: job.location,
      workMode: normalizeWorkMode(job.workMode),
      description: job.description,
      requirements: job.requirements,
      candidateCriteria: job.candidateCriteria,
      postedAt: job.postedAt ?? null,
      sourceQuery: job.sourceQuery,
      externalUrl: job.url,
      rawJson: { sample: true },
      parseStatus: "parsed",
      markChecked: true
    });
    imported += 1;
  }
  return imported;
}

// ─── Internals ─────────────────────────────────────────────────────────────

const BASE_SELECT = `SELECT
    l.id, l.source_id, l.external_id, l.title, l.company, l.location, l.work_mode,
    l.description, l.requirements, l.candidate_criteria, l.posted_at, l.source_query,
    l.external_url, l.status, l.last_seen_at, l.last_checked_at,
    s.name AS source_name, s.category AS source_category
  FROM job_listings l
  JOIN job_sources s ON s.id = l.source_id`;

function collect(target: Map<number, JobListingRecord>, rows: mysql.RowDataPacket[]) {
  for (const row of rows) {
    const record = mapListingRow(row);
    if (!target.has(record.id)) {
      target.set(record.id, record);
    }
  }
}

function mapListingRow(row: mysql.RowDataPacket): JobListingRecord {
  const workModeRaw = row.work_mode ? String(row.work_mode) : undefined;
  return {
    id: Number(row.id),
    sourceId: Number(row.source_id),
    platform: String(row.source_name),
    category: normalizeSourceCategory(row.source_category),
    externalId: row.external_id ? String(row.external_id) : undefined,
    title: String(row.title ?? ""),
    company: row.company ? String(row.company) : undefined,
    location: row.location ? String(row.location) : undefined,
    workMode: workModeRaw && workModeRaw !== "any" ? (workModeRaw as WorkMode) : undefined,
    description: String(row.description ?? ""),
    requirements: parseJsonField<string[]>(row.requirements, []),
    candidateCriteria: parseJsonField<string[]>(row.candidate_criteria, []),
    externalUrl: String(row.external_url ?? ""),
    sourceQuery: row.source_query ? String(row.source_query) : undefined,
    postedAt: row.posted_at ? toIso(row.posted_at) : undefined,
    status: normalizeStatus(row.status),
    lastSeenAt: row.last_seen_at ? toIso(row.last_seen_at) : undefined,
    lastCheckedAt: row.last_checked_at ? toIso(row.last_checked_at) : undefined
  };
}

function buildFulltextQuery(profile: CandidateProfile): string {
  const terms = [
    profile.targetRole,
    ...profile.titles.slice(0, 4),
    ...profile.skills.slice(0, 8),
    ...profile.keywords.slice(0, 8)
  ];
  return dedupeTerms(terms).join(" ").slice(0, 240);
}

function buildLikeTerms(profile: CandidateProfile): string[] {
  const terms = [profile.targetRole, ...profile.titles.slice(0, 3), ...profile.skills.slice(0, 6)];
  return dedupeTerms(terms)
    .filter((term) => term.length >= 3)
    .slice(0, 8);
}

function dedupeTerms(terms: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = (raw ?? "").trim();
    if (term.length < 2) {
      continue;
    }
    const key = term.toLocaleLowerCase("tr-TR");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(term);
    }
  }
  return out;
}

function normalizeSourceCategory(value: unknown): JobResultCategory {
  return value === "tech" || value === "public" ? value : "general";
}

function normalizeStatus(value: unknown): JobListingStatus {
  return value === "stale" || value === "expired" || value === "failed" ? value : "active";
}

function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deriveBaseUrl(name: string): string {
  const slug = name.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9]+/g, "");
  return `https://www.${slug || "kaynak"}.com`;
}

function toMysqlDate(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(value: unknown): string | undefined {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function logListingNote(id: number, reason: string) {
  console.log(`[repository] listing ${id}: ${reason}`);
}
