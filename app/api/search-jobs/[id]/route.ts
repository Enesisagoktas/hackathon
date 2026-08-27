import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { ensureJobQueueSchema, parseJsonField } from "@/lib/job-queue";
import { ensureJobWorkerRunning } from "@/lib/job-worker";
import { getSessionUserId } from "@/lib/auth/session";
import mysql from "mysql2/promise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STALE_PROCESSING_MINUTES = readPositiveNumber(process.env.JOB_STALE_PROCESSING_MINUTES, 2);

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const searchId = parseInt(params.id, 10);
    
    if (isNaN(searchId)) {
      return NextResponse.json({ message: "Geçersiz ID" }, { status: 400 });
    }

    await ensureJobQueueSchema();
    const pool = getDbPool();
    
    // Fetch the job_searches record
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT status, progress, started_at, completed_at, error_message, locked_at, updated_at,
              user_id, ai_profile, evaluation, summary, results, apply_summary,
              selected_positions, seniority_filter, search_note
       FROM job_searches
       WHERE id = ?`,
      [searchId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ message: "Arama bulunamadı" }, { status: 404 });
    }

    let row = rows[0];

    // Sahiplik kontrolü: bir aramanın CV profili ve değerlendirmesi kişisel
    // veridir; yalnızca sahibi okuyabilir.
    //
    // user_id NULL olan kayıtlar (user_id kolonu eklenmeden önce oluşmuş eski
    // satırlar) SAHİPSİZDİR ve kimseye açılmaz. Önceki sürümde kontrol
    // "user_id != null && ..." şeklindeydi; bu, sahipsiz kayıtları oturumsuz
    // herkese okutuyordu.
    //
    // Var olmayan kayıtla aynı yanıt döner ki id denemesiyle varlık anlaşılmasın.
    const sessionUserId = getSessionUserId();
    if (row.user_id == null || sessionUserId == null || Number(row.user_id) !== sessionUserId) {
      return NextResponse.json({ message: "Arama bulunamadı" }, { status: 404 });
    }

    if (row.status === "processing" && isStaleProcessing(row)) {
      await pool.query(
        `UPDATE job_searches
         SET status = 'pending',
             progress = LEAST(progress, 50),
             locked_at = NULL,
             error_message = 'Önceki tarama sıkıştı, otomatik yeniden deneniyor.',
             updated_at = NOW()
         WHERE id = ? AND status = 'processing'`,
        [searchId]
      );

      const [freshRows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT status, progress, started_at, completed_at, error_message, locked_at, updated_at,
                user_id, ai_profile, evaluation, summary, results, apply_summary,
                selected_positions, seniority_filter, search_note
         FROM job_searches
         WHERE id = ?`,
        [searchId]
      );
      row = freshRows[0] ?? row;
    }

    if (row.status === "pending" || row.status === "processing") {
      ensureJobWorkerRunning();
    }

    const aiProfile = parseJsonField<Record<string, any> | null>(row.ai_profile, null);

    return NextResponse.json({
      id: searchId,
      status: row.status,
      progress: row.progress,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message,
      aiProfile,
      evaluation: parseJsonField(row.evaluation, null),
      summary: parseJsonField(row.summary, null),
      results: parseJsonField(row.results, []),
      applySummary: parseJsonField(row.apply_summary, null),
      // Pozisyon seçim ekranı için: AI'nın en güçlü gördüğü 5 pozisyon.
      suggestedPositions: buildSuggestedPositions(aiProfile),
      selectedPositions: parseJsonField(row.selected_positions, []),
      seniorityFilter: row.seniority_filter ?? "any",
      searchNote: row.search_note ?? null
    });
    
  } catch (error) {
    console.error("GET /api/search-jobs/[id] failed:", error);
    return NextResponse.json({ message: "Durum sorgulanırken hata oluştu" }, { status: 500 });
  }
}

/**
 * AI profil çıktısından, kullanıcının seçim yapacağı en güçlü 5 pozisyonu
 * derler. Sıra önceliği: hedef pozisyonlar > uygun unvanlar > tercih edilen
 * roller (hepsi AI'nın CV'den çıkardığı gerçek öneriler).
 */
function buildSuggestedPositions(aiProfile: Record<string, any> | null): string[] {
  if (!aiProfile) {
    return [];
  }

  const nested = aiProfile.aiProfile ?? {};
  const candidates: unknown[] = [
    ...(Array.isArray(nested.targetPositions) ? nested.targetPositions : []),
    ...(Array.isArray(aiProfile.titles) ? aiProfile.titles : []),
    ...(Array.isArray(nested.preferredRoles) ? nested.preferredRoles : [])
  ];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = candidate.replace(/\s+/g, " ").trim();
    const key = value.toLocaleLowerCase("tr-TR");
    if (value.length < 2 || value.length > 80 || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= 5) break;
  }

  return out;
}

function isStaleProcessing(row: mysql.RowDataPacket) {
  const lockedAt = toTime(row.locked_at);
  const updatedAt = toTime(row.updated_at);
  const lastActivity = Math.max(lockedAt, updatedAt);

  if (!lastActivity) {
    return true;
  }

  return Date.now() - lastActivity > STALE_PROCESSING_MINUTES * 60 * 1000;
}

function toTime(value: unknown) {
  if (!value) {
    return 0;
  }

  const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : 0;
}

function readPositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
