import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import { ensureJobQueueSchema, parseJsonField } from "@/lib/job-queue";
import { ensureJobWorkerRunning } from "@/lib/job-worker";
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
              ai_profile, evaluation, summary, results
       FROM job_searches 
       WHERE id = ?`,
      [searchId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ message: "Arama bulunamadı" }, { status: 404 });
    }

    let row = rows[0];

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
                ai_profile, evaluation, summary, results
         FROM job_searches
         WHERE id = ?`,
        [searchId]
      );
      row = freshRows[0] ?? row;
    }

    if (row.status === "pending" || row.status === "processing") {
      ensureJobWorkerRunning();
    }

    return NextResponse.json({
      id: searchId,
      status: row.status,
      progress: row.progress,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message,
      aiProfile: parseJsonField(row.ai_profile, null),
      evaluation: parseJsonField(row.evaluation, null),
      summary: parseJsonField(row.summary, null),
      results: parseJsonField(row.results, [])
    });
    
  } catch (error) {
    console.error("GET /api/search-jobs/[id] failed:", error);
    return NextResponse.json({ message: "Durum sorgulanırken hata oluştu" }, { status: 500 });
  }
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
