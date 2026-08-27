import mysql from "mysql2/promise";

import { getDbPool } from "@/lib/db";
import type { LocationMode, WorkMode } from "@/lib/search-preferences";

export type QueuedFileType = "pdf" | "docx";

export type EnqueueJobSearchInput = {
  cvText: string;
  fileType: QueuedFileType;
  userEmail?: string;
  /** Oturumdaki kullanıcı. Başvuru üretimi buna bağlıdır. */
  userId?: number;
  /** Kaydedilmiş ana CV kaydı (user_cvs.id). */
  cvId?: number;
  locationMode: LocationMode;
  cities: string[];
  workMode: WorkMode;
};

/** Kullanıcının aradığı ilan seviyesi. */
export type SeniorityFilter = "any" | "stajyer" | "junior" | "mid" | "senior";

export type JobSearchQueueRow = mysql.RowDataPacket & {
  id: number;
  user_email: string | null;
  user_id: number | null;
  cv_id: number | null;
  cv_text: string | null;
  file_type: QueuedFileType | null;
  location_mode: LocationMode | null;
  cities: string | string[] | null;
  work_mode: WorkMode | null;
  ai_profile: unknown;
  evaluation: unknown;
  attempts: number | null;
  /** Kullanıcının analiz sonrası seçtiği hedef pozisyonlar (JSON dizi). */
  selected_positions: unknown;
  seniority_filter: SeniorityFilter | null;
  /** Kullanıcının aramaya not düştüğü 3-4 cümlelik serbest metin. */
  search_note: string | null;
};

let schemaEnsurePromise: Promise<void> | null = null;

export async function enqueueJobSearch(input: EnqueueJobSearchInput) {
  await ensureJobQueueSchema();

  const pool = getDbPool();
  const [result] = await pool.query<mysql.ResultSetHeader>(
    `INSERT INTO job_searches
       (user_email, user_id, cv_id, status, progress, cv_text, file_type, location_mode, cities, work_mode, started_at, updated_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      input.userEmail ?? null,
      input.userId ?? null,
      input.cvId ?? null,
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

  if (!existing.has("user_id")) {
    alters.push("ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER user_email");
  }

  if (!existing.has("cv_id")) {
    alters.push("ADD COLUMN cv_id BIGINT UNSIGNED NULL AFTER user_id");
  }

  if (!existing.has("apply_summary")) {
    alters.push("ADD COLUMN apply_summary JSON NULL AFTER summary");
  }

  if (!existing.has("selected_positions")) {
    alters.push("ADD COLUMN selected_positions JSON NULL AFTER work_mode");
  }

  if (!existing.has("seniority_filter")) {
    alters.push("ADD COLUMN seniority_filter VARCHAR(20) NULL AFTER selected_positions");
  }

  if (!existing.has("search_note")) {
    alters.push("ADD COLUMN search_note VARCHAR(600) NULL AFTER seniority_filter");
  }

  // Akış artık iki aşamalı: analiz bitince iş 'awaiting_selection' durumunda
  // durur, kullanıcı pozisyon seçince tekrar kuyruğa girer. Eski enum bu
  // değeri tanımıyorsa genişlet (mevcut satırların değeri korunur).
  const statusColumn = columns.find((column) => String(column.Field) === "status");
  const statusType = statusColumn ? String(statusColumn.Type).toLocaleLowerCase("tr-TR") : "";
  if (statusType && !statusType.includes("awaiting_selection")) {
    alters.push(
      "MODIFY COLUMN status ENUM('pending', 'processing', 'awaiting_selection', 'completed', 'failed') NOT NULL DEFAULT 'pending'"
    );
  }

  if (alters.length) {
    await pool.query(`ALTER TABLE job_searches ${alters.join(", ")}`);
  }
}
