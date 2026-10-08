import { NextResponse } from "next/server";
import mysql from "mysql2/promise";

import { getSessionUserId } from "@/lib/auth/session";
import { getDbPool } from "@/lib/db";
import { ensureJobQueueSchema, type SeniorityFilter } from "@/lib/job-queue";
import { ensureJobWorkerRunning } from "@/lib/job-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SENIORITY: SeniorityFilter[] = ["any", "stajyer", "junior", "mid", "senior"];

/**
 * Analiz sonrası pozisyon seçimi.
 *
 * Kullanıcı AI'nın önerdiği pozisyonlardan 1-5 tanesini seçer, istersen seviye
 * filtresi ve kısa bir arama notu ekler. Kayıt tekrar 'pending' olur; worker
 * analizi cache'ten okuyup doğrudan arama aşamasına geçer.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const searchId = Number.parseInt(params.id, 10);

    if (!Number.isFinite(searchId)) {
      return NextResponse.json({ message: "Geçersiz arama numarası." }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as {
      positions?: unknown;
      seniority?: unknown;
      note?: unknown;
    } | null;

    const positions = Array.isArray(body?.positions)
      ? body!.positions
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.replace(/[<>"'`]/g, "").replace(/\s+/g, " ").trim())
          .filter((item) => item.length >= 2 && item.length <= 80)
          .slice(0, 5)
      : [];

    if (!positions.length) {
      return NextResponse.json({ message: "En az bir hedef pozisyon seçin." }, { status: 400 });
    }

    const seniority: SeniorityFilter = VALID_SENIORITY.includes(body?.seniority as SeniorityFilter)
      ? (body!.seniority as SeniorityFilter)
      : "any";

    const note =
      typeof body?.note === "string" && body.note.trim() ? body.note.replace(/\s+/g, " ").trim().slice(0, 600) : null;

    await ensureJobQueueSchema();
    const pool = getDbPool();

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT user_id, status FROM job_searches WHERE id = ?",
      [searchId]
    );

    if (!rows[0]) {
      return NextResponse.json({ message: "Arama bulunamadı." }, { status: 404 });
    }

    // Sahiplik: yalnızca kaydın sahibi seçim yapabilir. user_id NULL olan eski
    // (sahipsiz) kayıtlar kimseye açılmaz — aksi halde oturumsuz biri başkasının
    // CV'siyle arama tetikleyebilirdi.
    const sessionUserId = getSessionUserId();
    if (rows[0].user_id == null || sessionUserId == null || Number(rows[0].user_id) !== sessionUserId) {
      return NextResponse.json({ message: "Arama bulunamadı." }, { status: 404 });
    }

    // Yalnızca seçim bekleyen (veya seçimi değiştirilmek istenen tamamlanmış)
    // kayıtlarda çalışır; işlenmekte olan bir kaydın altından durum çekilmez.
    const status = String(rows[0].status);
    if (status !== "awaiting_selection" && status !== "completed" && status !== "failed") {
      return NextResponse.json(
        { message: "Bu arama şu anda işleniyor; seçim için analizin bitmesini bekleyin." },
        { status: 409 }
      );
    }

    // Eski turun çıktıları temizlenir: yeni tur hata alırsa kullanıcı önceki
    // aramanın sonuçlarını "yeni sonuç" sanmamalı. attempts sıfırlanır çünkü
    // bu, kullanıcının bilinçli başlattığı yeni bir turdur.
    //
    // WHERE'deki durum koşulu, yukarıdaki SELECT ile bu UPDATE arasında
    // worker'ın işi kapması ihtimaline karşı yarışı kapatır.
    const [updateResult] = await pool.query<mysql.ResultSetHeader>(
      `UPDATE job_searches
       SET selected_positions = ?,
           seniority_filter = ?,
           search_note = ?,
           status = 'pending',
           progress = 45,
           attempts = 0,
           completed_at = NULL,
           error_message = NULL,
           locked_at = NULL,
           results = NULL,
           summary = NULL,
           apply_summary = NULL,
           result_count = 0,
           updated_at = NOW()
       WHERE id = ? AND status IN ('awaiting_selection', 'completed', 'failed')`,
      [JSON.stringify(positions), seniority, note, searchId]
    );

    if (updateResult.affectedRows === 0) {
      return NextResponse.json(
        { message: "Bu arama şu anda işleniyor; birkaç saniye sonra tekrar deneyin." },
        { status: 409 }
      );
    }

    ensureJobWorkerRunning();

    return NextResponse.json({
      ok: true,
      searchId,
      positions,
      seniority,
      note,
      message: "İlan araması başlatıldı."
    });
  } catch (error) {
    console.error("POST /api/search-jobs/[id]/select failed:", error);
    return NextResponse.json({ message: "Seçim kaydedilirken hata oluştu." }, { status: 500 });
  }
}
