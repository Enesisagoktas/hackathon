import "../lib/load-env";
import mysql from "mysql2/promise";
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";

import { closeDbPool } from "../lib/db";
import { ensureJobQueueSchema } from "../lib/job-queue";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

/**
 * Non-destructive migration.
 * - Runs database/schema.sql (CREATE TABLE IF NOT EXISTS + ON DUPLICATE KEY seed).
 * - Never drops tables or columns.
 * - Adds missing columns via ALTER TABLE ... ADD COLUMN.
 * - Widens enums in place (existing values are preserved).
 */
async function run() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST ?? "localhost",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE ?? "cvmatch",
    multipleStatements: true
  });

  try {
    const schemaPath = path.resolve(process.cwd(), "database/schema.sql");
    const schema = await fs.readFile(schemaPath, "utf-8");

    console.log("[migrate] Running database/schema.sql (non-destructive)...");
    await pool.query(schema);

    // CV uyarlama + başvuru tabloları. schema.sql'den SONRA çalışmalı:
    // user_cvs ve job_applications, users/job_listings tablolarına foreign key verir.
    const applicationsPath = path.resolve(process.cwd(), "database/applications.sql");
    const applicationsSchema = await fs.readFile(applicationsPath, "utf-8");

    console.log("[migrate] Running database/applications.sql (başvuru katmanı)...");
    await pool.query(applicationsSchema);

    console.log("[migrate] Ensuring job_searches columns...");
    await ensureJobQueueSchema();

    console.log("[migrate] Ensuring application_settings columns...");
    await ensureColumn(pool, "application_settings", "min_match_score", "INT UNSIGNED NOT NULL DEFAULT 0");

    console.log("[migrate] Ensuring job_listings columns...");
    await ensureJobListingsColumns(pool);

    warnAboutAppSecret();

    console.log("[migrate] Database is up to date.");
  } catch (error) {
    console.error("[migrate] Migration failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => undefined);
    await closeDbPool().catch(() => undefined);
  }
}

// Full target shape for job_listings. Older databases may be missing many of
// these; each missing column is added without an AFTER clause so order never
// depends on a column that does not exist yet.
const JOB_LISTINGS_COLUMNS: Array<[string, string]> = [
  ["external_id", "VARCHAR(190) NULL"],
  ["company", "VARCHAR(190) NULL"],
  ["location", "VARCHAR(190) NULL"],
  ["work_mode", "ENUM('any', 'remote', 'hybrid', 'onsite') NULL"],
  ["description", "TEXT NULL"],
  ["requirements", "JSON NULL"],
  ["candidate_criteria", "JSON NULL"],
  ["salary_text", "VARCHAR(190) NULL"],
  ["posted_at", "DATETIME NULL"],
  ["expires_at", "DATETIME NULL"],
  ["source_query", "VARCHAR(255) NULL"],
  ["content_hash", "VARCHAR(64) NULL"],
  ["matched_keywords", "JSON NULL"],
  ["raw_json", "JSON NULL"],
  ["parse_status", "ENUM('parsed', 'summary_only', 'failed') NOT NULL DEFAULT 'parsed'"],
  ["parse_version", "VARCHAR(40) NULL"],
  ["error_count", "INT UNSIGNED NOT NULL DEFAULT 0"],
  ["first_seen_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
  ["last_seen_at", "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"],
  ["last_checked_at", "DATETIME NULL"]
];

async function ensureJobListingsColumns(pool: mysql.Pool) {
  const [columns] = await pool.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM job_listings");
  const byField = new Map(columns.map((column) => [String(column.Field), column]));
  const alters: string[] = [];

  for (const [name, definition] of JOB_LISTINGS_COLUMNS) {
    if (!byField.has(name)) {
      alters.push(`ADD COLUMN ${name} ${definition}`);
    }
  }

  // Widen status enum to include 'failed' if an older schema only had the 3 states.
  const statusColumn = byField.get("status");
  const statusType = statusColumn ? String(statusColumn.Type).toLowerCase() : "";
  if (statusType && !statusType.includes("failed")) {
    alters.push("MODIFY COLUMN status ENUM('active', 'stale', 'expired', 'failed') NOT NULL DEFAULT 'active'");
  }

  if (alters.length) {
    console.log(`[migrate] Applying ${alters.length} job_listings change(s)...`);
    await pool.query(`ALTER TABLE job_listings ${alters.join(", ")}`);
  }

  // Indexes the cache search depends on (FULLTEXT especially — MATCH() fails without it).
  await ensureUniqueIndex(pool, "job_listings", "job_listings_source_url_unique", "(source_id, external_url(255))");
  await ensureIndex(pool, "job_listings", "job_listings_status_seen_idx", "(status, last_seen_at)");
  await ensureIndex(pool, "job_listings", "job_listings_status_checked_idx", "(status, last_checked_at)");
  await ensureFulltextIndex(pool, "job_listings", "job_listings_fulltext_idx", "(title, company, description)");
}

/**
 * APP_SECRET olmadan oturum açılamaz ve SMTP şifresi saklanamaz; bu yüzden
 * migrate sırasında eksikliği yüksek sesle uyarılır.
 */
function warnAboutAppSecret() {
  const secret = process.env.APP_SECRET;

  if (!secret || secret.length < 32) {
    console.warn(
      "\n[migrate] UYARI: APP_SECRET tanımlı değil veya 32 karakterden kısa.\n" +
        "  Giriş ve otomatik başvuru bu değer olmadan çalışmaz.\n" +
        "  Üretmek için: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"\n" +
        "  Sonucu .env dosyasına APP_SECRET=... olarak ekleyin.\n"
    );
  }
}

async function indexMissing(pool: mysql.Pool, table: string, indexName: string) {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?",
    [table, indexName]
  );
  return Number(rows[0]?.count ?? 0) === 0;
}

async function ensureIndex(pool: mysql.Pool, table: string, indexName: string, definition: string) {
  if (await indexMissing(pool, table, indexName)) {
    await pool.query(`ALTER TABLE ${table} ADD INDEX ${indexName} ${definition}`);
  }
}

async function ensureUniqueIndex(pool: mysql.Pool, table: string, indexName: string, definition: string) {
  if (await indexMissing(pool, table, indexName)) {
    await pool.query(`ALTER TABLE ${table} ADD UNIQUE KEY ${indexName} ${definition}`);
  }
}

async function ensureFulltextIndex(pool: mysql.Pool, table: string, indexName: string, definition: string) {
  if (await indexMissing(pool, table, indexName)) {
    await pool.query(`ALTER TABLE ${table} ADD FULLTEXT KEY ${indexName} ${definition}`);
  }
}

run();


/** Tek kolon ekleme (varsa dokunmaz) — geri uyumlu, veri kaybı yok. */
async function ensureColumn(
  pool: mysql.Pool,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (!rows.length) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[migrate]   + ${table}.${column}`);
  }
}
