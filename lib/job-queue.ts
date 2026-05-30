import mysql from "mysql2/promise";

import { getDbPool } from "@/lib/db";
import type { LocationMode, WorkMode } from "@/lib/search-preferences";

export type QueuedFileType = "pdf" | "docx";

export type EnqueueJobSearchInput = {
  cvText: string;
  fileType: QueuedFileType;
  userEmail?: string;
  locationMode: LocationMode;
  cities: string[];
  workMode: WorkMode;
};

export type JobSearchQueueRow = mysql.RowDataPacket & {
  id: number;
  user_email: string | null;
  cv_text: string | null;
  file_type: QueuedFileType | null;
  location_mode: LocationMode | null;
  cities: string | string[] | null;
  work_mode: WorkMode | null;
  ai_profile: unknown;
  evaluation: unknown;
  attempts: number | null;
};

let schemaEnsurePromise: Promise<void> | null = null;

export async function enqueueJobSearch(input: EnqueueJobSearchInput) {
  await ensureJobQueueSchema();

  const pool = getDbPool();
  const [result] = await pool.query<mysql.ResultSetHeader>(
    `INSERT INTO job_searches
       (user_email, status, progress, cv_text, file_type, location_mode, cities, work_mode, started_at, updated_at)
     VALUES (?, 'pending', 0, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      input.userEmail ?? null,
      input.cvText,
      input.fileType,
      input.locationMode,
      JSON.stringify(input.cities),
      input.workMode
    ]
  );

  return {
    searchId: result.insertId
  };
}

export function ensureJobQueueSchema() {
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = doEnsureJobQueueSchema().catch((error) => {
      schemaEnsurePromise = null;
      throw error;
    });
  }

  return schemaEnsurePromise;
}

export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  return value as T;
}

async function doEnsureJobQueueSchema() {
  const pool = getDbPool();
  const [columns] = await pool.query<mysql.RowDataPacket[]>("SHOW COLUMNS FROM job_searches");
  const existing = new Set(columns.map((column) => String(column.Field)));
  const alters: string[] = [];

  if (!existing.has("file_type")) {
    alters.push("ADD COLUMN file_type ENUM('pdf', 'docx') NULL AFTER cv_text");
  }

  if (!existing.has("location_mode")) {
    alters.push("ADD COLUMN location_mode ENUM('all-turkey', 'cities') NOT NULL DEFAULT 'all-turkey' AFTER titles");
  }

  if (!existing.has("attempts")) {
    alters.push("ADD COLUMN attempts INT UNSIGNED NOT NULL DEFAULT 0 AFTER error_message");
  }

  if (!existing.has("locked_at")) {
    alters.push("ADD COLUMN locked_at DATETIME NULL AFTER attempts");
  }

  if (!existing.has("updated_at")) {
    alters.push("ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at");
  }

  if (alters.length) {
    await pool.query(`ALTER TABLE job_searches ${alters.join(", ")}`);
  }
}
