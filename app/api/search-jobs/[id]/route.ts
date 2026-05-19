import { NextResponse } from "next/server";
import { getDbPool } from "@/lib/db";
import mysql from "mysql2/promise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const searchId = parseInt(params.id, 10);
    
    if (isNaN(searchId)) {
      return NextResponse.json({ message: "Geçersiz ID" }, { status: 400 });
    }

    const pool = getDbPool();
    
    // Fetch the job_searches record
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT status, progress, ready_at, started_at, completed_at, error_message,
              ai_profile, evaluation, summary, results
       FROM job_searches 
       WHERE id = ?`,
      [searchId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ message: "Arama bulunamadı" }, { status: 404 });
    }

    const row = rows[0];

    // Note: cv_text is excluded from the response for privacy and size.
    // ai_profile, evaluation, summary, and results are stored as JSON strings in DB usually
    // or as parsed objects depending on mysql driver config, we will safely parse them.
    
    const safeParse = (data: any) => {
      if (typeof data === "string") {
        try { return JSON.parse(data); } catch { return null; }
      }
      return data;
    };

    return NextResponse.json({
      id: searchId,
      status: row.status,
      progress: row.progress,
      startedAt: row.started_at,
      readyAt: row.ready_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message,
      aiProfile: safeParse(row.ai_profile),
      evaluation: safeParse(row.evaluation),
      summary: safeParse(row.summary),
      results: safeParse(row.results) || []
    });
    
  } catch (error) {
    console.error("GET /api/search-jobs/[id] failed:", error);
    return NextResponse.json({ message: "Durum sorgulanırken hata oluştu" }, { status: 500 });
  }
}
