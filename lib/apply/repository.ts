import mysql from "mysql2/promise";

import { getDbPool } from "@/lib/db";
import { parseJsonField } from "@/lib/job-queue";
import { normalizeTailoredCv } from "@/lib/cv/types";
import type { GapItem, KeywordAlignmentItem, TailoredCv } from "@/lib/cv/types";
import type { ApplicationChannel } from "@/lib/apply/channel";

export type ApplicationStatus =
  | "preparing"
  | "needs_review"
  | "queued"
  | "sent"
  | "manual_required"
  | "skipped"
  | "failed";

export type JobApplication = {
  id: number;
  userId: number;
  listingId?: number;
  searchId?: number;
  cvId?: number;
  listingTitle: string;
  listingCompany?: string;
  listingLocation?: string;
  listingPlatform?: string;
  listingUrl: string;
  /** Bağlı ilanın güncel durumu; expired ise "İlanı Aç" uyarıyla gösterilir. */
  listingStatus?: "active" | "stale" | "expired";
  matchScore: number;
  status: ApplicationStatus;
  channel: ApplicationChannel;
  recipientEmail?: string;
  recipientSource?: string;
  tailoredCv?: TailoredCv;
  coverLetter?: string;
  emailSubject?: string;
  gapReport: GapItem[];
  keywordAlignment: KeywordAlignmentItem[];
  tailoringSource: "ai" | "heuristic";
  hasPdf: boolean;
  hasDocx: boolean;
  autoApplied: boolean;
  approvedAt?: string;
  sentAt?: string;
  attempts: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type ApplicationEvent = {
  id: number;
  eventType: string;
  message?: string;
  createdAt: string;
};

export type CreateApplicationInput = {
  userId: number;
  listingId?: number;
  searchId?: number;
  cvId?: number;
  listingTitle: string;
  listingCompany?: string;
  listingLocation?: string;
  listingPlatform?: string;
  listingUrl: string;
  matchScore: number;
};

/**
 * Başvuru kaydını oluşturur. Aynı kullanıcı + aynı ilan için ikinci kez
 * çağrılırsa yeni kayıt açmaz, mevcut kaydın id'sini `created: false` ile döner.
 * Bu, worker her çalıştığında aynı ilana tekrar başvurulmasını engeller.
 */
export async function createApplication(
  input: CreateApplicationInput
): Promise<{ id: number; created: boolean }> {
  const pool = getDbPool();

  const [existingRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id FROM job_applications WHERE user_id = ? AND listing_url = ? LIMIT 1",
    [input.userId, input.listingUrl]
  );

  if (existingRows[0]) {
    return { id: Number(existingRows[0].id), created: false };
  }

  try {
    const [result] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO job_applications
         (user_id, listing_id, search_id, cv_id, listing_title, listing_company, listing_location,
          listing_platform, listing_url, match_score, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preparing')`,
      [
        input.userId,
        input.listingId ?? null,
        input.searchId ?? null,
        input.cvId ?? null,
        input.listingTitle.slice(0, 255),
        input.listingCompany?.slice(0, 190) ?? null,
        input.listingLocation?.slice(0, 190) ?? null,
        input.listingPlatform?.slice(0, 80) ?? null,
        input.listingUrl.slice(0, 700),
        Math.max(0, Math.min(100, Math.round(input.matchScore)))
      ]
    );

    return { id: result.insertId, created: true };
  } catch (error) {
    // Eşzamanlı iki worker aynı anda eklerse UNIQUE kısıtı devreye girer.
    if (isDuplicateKeyError(error)) {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT id FROM job_applications WHERE user_id = ? AND listing_url = ? LIMIT 1",
        [input.userId, input.listingUrl]
      );
      if (rows[0]) {
        return { id: Number(rows[0].id), created: false };
      }
    }
    throw error;
  }
}

export type SaveTailoringInput = {
  applicationId: number;
  tailoredCv: TailoredCv;
  coverLetter: string;
  emailSubject: string;
  gaps: GapItem[];
  keywordAlignment: KeywordAlignmentItem[];
  tailoringSource: "ai" | "heuristic";
  pdfPath: string;
  docxPath: string;
  channel: ApplicationChannel;
  recipientEmail?: string;
  recipientSource?: string;
  status: ApplicationStatus;
};

export async function saveTailoring(input: SaveTailoringInput): Promise<void> {
  const pool = getDbPool();

  await pool.query(
    `UPDATE job_applications
     SET tailored_cv = ?, cover_letter = ?, email_subject = ?, gap_report = ?, keyword_alignment = ?,
         tailoring_source = ?, pdf_path = ?, docx_path = ?, channel = ?, recipient_email = ?,
         recipient_source = ?, status = ?, error_message = NULL, updated_at = NOW()
     WHERE id = ?`,
    [
      JSON.stringify(input.tailoredCv),
      input.coverLetter,
      input.emailSubject.slice(0, 255),
      JSON.stringify(input.gaps),
      JSON.stringify(input.keywordAlignment),
      input.tailoringSource,
      input.pdfPath || null,
      input.docxPath || null,
      input.channel,
      input.recipientEmail ?? null,
      input.recipientSource ?? null,
      input.status,
      input.applicationId
    ]
  );
}

export async function markApplicationSent(
  applicationId: number,
  options: { autoApplied: boolean; messageId?: string }
): Promise<void> {
  const pool = getDbPool();

  await pool.query(
    `UPDATE job_applications
     SET status = 'sent', sent_at = NOW(), auto_applied = ?, approved_at = COALESCE(approved_at, NOW()),
         attempts = attempts + 1, error_message = NULL, updated_at = NOW()
     WHERE id = ?`,
    [options.autoApplied, applicationId]
  );

  await addApplicationEvent(applicationId, "sent", options.autoApplied ? "Otomatik gönderildi." : "Onaylanıp gönderildi.", {
    messageId: options.messageId
  });
}

export async function markApplicationFailed(applicationId: number, message: string): Promise<void> {
  const pool = getDbPool();

  await pool.query(
    `UPDATE job_applications
     SET status = 'failed', attempts = attempts + 1, error_message = ?, updated_at = NOW()
     WHERE id = ?`,
    [message.slice(0, 2000), applicationId]
  );

  await addApplicationEvent(applicationId, "failed", message.slice(0, 500));
}

/**
 * Kullanıcının elle girdiği başvuru adresini kaydeder ve başvuruyu e-posta
 * kanalına geçirir.
 *
 * Neden gerekli: Türkiye'nin büyük ilan siteleri (Kariyer.net, Secretcv,
 * Eleman.net) işveren e-postasını yayınlamıyor — başvuruyu kendi portallarına
 * zorluyorlar. Ölçüldü: aktif ilanların hiçbirinin metninde e-posta yok.
 * Ama kullanıcı şirketin İK adresini çoğu zaman biliyor veya şirketin
 * sitesinden bulabiliyor. Bu fonksiyon o bilgiyi sisteme sokarak otomasyonu
 * portal-only ilanlarda da kullanılabilir kılar.
 *
 * `recipient_source = 'manual'`: pipeline bu kaynaklı adreslere ASLA otomatik
 * gönderim yapmaz; kullanıcı her seferinde kendi onaylar.
 */
export async function setApplicationRecipient(
  applicationId: number,
  userId: number,
  email: string
): Promise<void> {
  const pool = getDbPool();

  const [result] = await pool.query<mysql.ResultSetHeader>(
    `UPDATE job_applications
     SET recipient_email = ?,
         recipient_source = 'manual',
         channel = 'email',
         status = IF(status = 'sent', status, 'needs_review'),
         error_message = NULL,
         updated_at = NOW()
     WHERE id = ? AND user_id = ?`,
    [email, applicationId, userId]
  );

  if (result.affectedRows === 0) {
    throw new Error("Başvuru bulunamadı.");
  }

  await addApplicationEvent(applicationId, "recipient_set", `Başvuru adresi elle girildi: ${email}`);
}

export async function updateApplicationStatus(
  applicationId: number,
  status: ApplicationStatus,
  message?: string
): Promise<void> {
  const pool = getDbPool();

  await pool.query(
    `UPDATE job_applications
     SET status = ?, approved_at = IF(? IN ('queued', 'sent'), COALESCE(approved_at, NOW()), approved_at),
         updated_at = NOW()
     WHERE id = ?`,
    [status, status, applicationId]
  );

  await addApplicationEvent(applicationId, status, message);
}

export async function addApplicationEvent(
  applicationId: number,
  eventType: string,
  message?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const pool = getDbPool();

  await pool.query(
    "INSERT INTO application_events (application_id, event_type, message, metadata) VALUES (?, ?, ?, ?)",
    [applicationId, eventType.slice(0, 40), message?.slice(0, 2000) ?? null, metadata ? JSON.stringify(metadata) : null]
  );
}

export async function listApplications(
  userId: number,
  options: { status?: ApplicationStatus; limit?: number } = {}
): Promise<JobApplication[]> {
  const pool = getDbPool();
  const limit = Math.max(1, Math.min(200, options.limit ?? 100));

  const where = ["user_id = ?"];
  const params: unknown[] = [userId];

  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }

  // İlanın güncel durumu da taşınır: kullanıcı "İlanı Aç" demeden önce
  // yayından kalkmış ilanı görebilmeli (tıklayınca site ana sayfaya düşüyor).
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT a.*, l.status AS listing_status FROM job_applications a
     LEFT JOIN job_listings l ON l.id = a.listing_id
     WHERE ${where.map((clause) => `a.${clause}`).join(" AND ")}
     ORDER BY
       -- Önce eylem gerektirenler, sonra skora göre.
       FIELD(a.status, 'needs_review', 'manual_required', 'queued', 'preparing', 'sent', 'failed', 'skipped'),
       a.match_score DESC,
       a.created_at DESC
     LIMIT ?`,
    [...params, limit]
  );

  return rows.map(mapApplicationRow);
}

export async function getApplication(applicationId: number, userId: number): Promise<JobApplication | null> {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT * FROM job_applications WHERE id = ? AND user_id = ? LIMIT 1",
    [applicationId, userId]
  );

  return rows[0] ? mapApplicationRow(rows[0]) : null;
}

/** Dosya indirme için gerçek disk yollarını döner (API dışına sızdırılmaz). */
export async function getApplicationFilePaths(
  applicationId: number,
  userId: number
): Promise<{ pdfPath?: string; docxPath?: string } | null> {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT pdf_path, docx_path FROM job_applications WHERE id = ? AND user_id = ? LIMIT 1",
    [applicationId, userId]
  );

  if (!rows[0]) {
    return null;
  }

  return {
    pdfPath: rows[0].pdf_path ?? undefined,
    docxPath: rows[0].docx_path ?? undefined
  };
}

export async function listApplicationEvents(applicationId: number): Promise<ApplicationEvent[]> {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, event_type, message, created_at FROM application_events WHERE application_id = ? ORDER BY created_at ASC LIMIT 100",
    [applicationId]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    eventType: String(row.event_type),
    message: row.message ?? undefined,
    createdAt: toIso(row.created_at)
  }));
}

export async function getApplicationStats(userId: number) {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT status, COUNT(*) AS count FROM job_applications WHERE user_id = ? GROUP BY status",
    [userId]
  );

  const stats: Record<string, number> = {
    preparing: 0, needs_review: 0, queued: 0, sent: 0, manual_required: 0, skipped: 0, failed: 0
  };

  for (const row of rows) {
    stats[String(row.status)] = Number(row.count);
  }

  stats.total = Object.values(stats).reduce((sum, value) => sum + value, 0);
  return stats;
}

// ─── Internals ────────────────────────────────────────────────────────────

function mapApplicationRow(row: mysql.RowDataPacket): JobApplication {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    listingId: row.listing_id != null ? Number(row.listing_id) : undefined,
    searchId: row.search_id != null ? Number(row.search_id) : undefined,
    cvId: row.cv_id != null ? Number(row.cv_id) : undefined,
    listingTitle: String(row.listing_title ?? ""),
    listingCompany: row.listing_company ?? undefined,
    listingLocation: row.listing_location ?? undefined,
    listingPlatform: row.listing_platform ?? undefined,
    listingUrl: String(row.listing_url ?? ""),
    listingStatus: row.listing_status ? (String(row.listing_status) as "active" | "stale" | "expired") : undefined,
    matchScore: Number(row.match_score ?? 0),
    status: normalizeStatus(row.status),
    channel: row.channel === "email" ? "email" : "portal",
    recipientEmail: row.recipient_email ?? undefined,
    recipientSource: row.recipient_source ?? undefined,
    tailoredCv: readTailoredCv(row.tailored_cv),
    coverLetter: row.cover_letter ?? undefined,
    emailSubject: row.email_subject ?? undefined,
    gapReport: parseJsonField<GapItem[]>(row.gap_report, []),
    keywordAlignment: parseJsonField<KeywordAlignmentItem[]>(row.keyword_alignment, []),
    tailoringSource: row.tailoring_source === "ai" ? "ai" : "heuristic",
    hasPdf: Boolean(row.pdf_path),
    hasDocx: Boolean(row.docx_path),
    autoApplied: Boolean(row.auto_applied),
    approvedAt: row.approved_at ? toIso(row.approved_at) : undefined,
    sentAt: row.sent_at ? toIso(row.sent_at) : undefined,
    attempts: Number(row.attempts ?? 0),
    errorMessage: row.error_message ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

const VALID_STATUSES: ApplicationStatus[] = [
  "preparing", "needs_review", "queued", "sent", "manual_required", "skipped", "failed"
];

function normalizeStatus(value: unknown): ApplicationStatus {
  const status = String(value) as ApplicationStatus;
  return VALID_STATUSES.includes(status) ? status : "preparing";
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ER_DUP_ENTRY";
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/**
 * Yeniden üretilen CV dosyalarının yollarını günceller.
 *
 * Gönderim anında dosyalar diskte bulunamazsa boru hattı bunları saklanan CV
 * verisinden yeniden üretir; yeni yolların kaybolmaması için buraya yazılır.
 */
export async function updateApplicationFilePaths(
  applicationId: number,
  userId: number,
  files: { pdfPath?: string; docxPath?: string }
): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    "UPDATE job_applications SET pdf_path = ?, docx_path = ?, updated_at = NOW() WHERE id = ? AND user_id = ?",
    [files.pdfPath ?? null, files.docxPath ?? null, applicationId, userId]
  );
}

/** Saklanan CV JSON'unu okur ve eksik dizi alanlarını tamamlar. */
function readTailoredCv(raw: unknown): TailoredCv | undefined {
  const parsed = parseJsonField<TailoredCv | undefined>(raw, undefined);
  return parsed ? normalizeTailoredCv(parsed) : undefined;
}
