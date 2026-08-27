import mysql from "mysql2/promise";

import { getDbPool } from "@/lib/db";
import { parseJsonField } from "@/lib/job-queue";
import type { AiExtractedProfile } from "@/lib/extract-keywords";
import type { CvEvaluation } from "@/lib/cv-evaluation";
import type { StructuredCv } from "@/lib/cv/types";

/**
 * Ana CV deposu.
 *
 * GİZLİLİK NOTU: Sistemin önceki sürümü CV metnini analiz biter bitmez
 * siliyordu. CV'yi her ilana göre yeniden yazabilmek için ham metnin
 * saklanması zorunludur. Bu yüzden metin artık kullanıcı hesabına bağlı
 * olarak tutulur ve `deleteUserCvs` ile tek adımda silinebilir; kullanıcı
 * hesabı silindiğinde de CASCADE ile birlikte gider.
 */

export type StoredCv = {
  id: number;
  userId: number;
  label: string;
  fileName?: string;
  fileType: "pdf" | "docx";
  rawText: string;
  aiProfile?: AiExtractedProfile;
  structuredCv?: StructuredCv;
  evaluation?: CvEvaluation;
  createdAt: string;
  updatedAt: string;
};

export type SaveCvInput = {
  userId: number;
  rawText: string;
  fileType: "pdf" | "docx";
  fileName?: string;
  label?: string;
  aiProfile?: AiExtractedProfile;
  structuredCv?: StructuredCv;
  evaluation?: CvEvaluation;
};

/**
 * Ana CV'yi kaydeder. Kullanıcının tek bir birincil CV'si olur; yeni yükleme
 * öncekinin üzerine yazar, böylece "güncel elimdeki CV" her zaman tektir.
 */
export async function savePrimaryCv(input: SaveCvInput): Promise<number> {
  const pool = getDbPool();

  const [existing] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id FROM user_cvs WHERE user_id = ? AND is_primary = TRUE LIMIT 1",
    [input.userId]
  );

  const params = [
    input.label ?? "Ana CV",
    input.fileName?.slice(0, 255) ?? null,
    input.fileType,
    input.rawText,
    input.aiProfile ? JSON.stringify(input.aiProfile) : null,
    input.structuredCv ? JSON.stringify(input.structuredCv) : null,
    input.evaluation ? JSON.stringify(input.evaluation) : null
  ];

  if (existing[0]) {
    const id = Number(existing[0].id);
    await pool.query(
      `UPDATE user_cvs
       SET label = ?, file_name = ?, file_type = ?, raw_text = ?,
           ai_profile = ?, structured_cv = ?, evaluation = ?, updated_at = NOW()
       WHERE id = ?`,
      [...params, id]
    );
    return id;
  }

  const [result] = await pool.query<mysql.ResultSetHeader>(
    `INSERT INTO user_cvs (user_id, label, file_name, file_type, raw_text, ai_profile, structured_cv, evaluation, is_primary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
    [input.userId, ...params]
  );

  return result.insertId;
}

/** Yapılandırılmış CV çıkarımı sonradan tamamlandığında kaydı günceller. */
export async function updateStructuredCv(cvId: number, structuredCv: StructuredCv): Promise<void> {
  const pool = getDbPool();
  await pool.query("UPDATE user_cvs SET structured_cv = ?, updated_at = NOW() WHERE id = ?", [
    JSON.stringify(structuredCv),
    cvId
  ]);
}

export async function getPrimaryCv(userId: number): Promise<StoredCv | null> {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT * FROM user_cvs WHERE user_id = ? AND is_primary = TRUE ORDER BY updated_at DESC LIMIT 1",
    [userId]
  );

  return rows[0] ? mapCvRow(rows[0]) : null;
}

export async function getCvById(cvId: number, userId: number): Promise<StoredCv | null> {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT * FROM user_cvs WHERE id = ? AND user_id = ? LIMIT 1",
    [cvId, userId]
  );

  return rows[0] ? mapCvRow(rows[0]) : null;
}

/** KVKK "unutulma hakkı": kullanıcının sakladığı tüm CV verisini siler. */
export async function deleteUserCvs(userId: number): Promise<number> {
  const pool = getDbPool();
  const [result] = await pool.query<mysql.ResultSetHeader>("DELETE FROM user_cvs WHERE user_id = ?", [userId]);
  return result.affectedRows;
}

function mapCvRow(row: mysql.RowDataPacket): StoredCv {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    label: String(row.label ?? "Ana CV"),
    fileName: row.file_name ?? undefined,
    fileType: row.file_type === "docx" ? "docx" : "pdf",
    rawText: String(row.raw_text ?? ""),
    aiProfile: parseJsonField<AiExtractedProfile | undefined>(row.ai_profile, undefined),
    structuredCv: parseJsonField<StructuredCv | undefined>(row.structured_cv, undefined),
    evaluation: parseJsonField<CvEvaluation | undefined>(row.evaluation, undefined),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
