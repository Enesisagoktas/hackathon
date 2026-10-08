import mysql from "mysql2/promise";

import { getDbPool } from "@/lib/db";
import type { JobPlatform, PlatformCrawlStatus } from "@/lib/jobs/types";

/**
 * §6 — Kaynak sağlık sistemi.
 *
 * NEDEN: Bir ilan sitesi sessizce bozulabilir — arama sayfası genel listeye
 * yönlenmeye başlar, Cloudflare devreye girer, seçiciler değişir. Bunlar hata
 * fırlatmaz; kaynak "başarılı" görünüp çöp veri döndürür. Ölçümde tam olarak
 * bu yaşandı: Yenibiriş 8 URL keşfediyor, hiçbirini parse edemiyor;
 * Toptalent sorguyu yok sayıp aynı ilanları döndürüyordu.
 *
 * Bu modül her taramanın sonucunu kaydeder, böylece bozulma tahminle değil
 * ölçümle görülür ve bozuk kaynak fark edilir.
 */

export type SourceHealthRecord = {
  platform: JobPlatform;
  lastStatus: PlatformCrawlStatus["status"];
  lastMessage?: string;
  lastCheckedAt: string;
  lastSuccessAt?: string;
  /** Son taramada kaç ilan parse edildi. */
  lastParsedCount: number;
  /** Son taramada kaç URL keşfedildi. */
  lastDiscoveredCount: number;
  /** Art arda kaç taramada hiç ilan alınamadı. */
  consecutiveFailures: number;
  /** Toplam tarama sayısı. */
  totalRuns: number;
  /** Hiç ilan döndürmeyen tarama sayısı. */
  emptyRuns: number;
  /** Kaynağın JavaScript gerektirdiği tespit edildi mi? */
  requiresJavaScript: boolean;
  /** Güvenlik engeli (Cloudflare vb.) görüldü mü? */
  blocked: boolean;
};

let schemaReady: Promise<void> | null = null;

/** Tablo yoksa oluşturur. Migration akışından bağımsız çalışabilmesi için. */
export async function ensureSourceHealthSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const pool = getDbPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS job_source_health (
          platform VARCHAR(64) NOT NULL PRIMARY KEY,
          last_status VARCHAR(24) NOT NULL,
          last_message VARCHAR(500) NULL,
          last_checked_at DATETIME NOT NULL,
          last_success_at DATETIME NULL,
          last_parsed_count INT UNSIGNED NOT NULL DEFAULT 0,
          last_discovered_count INT UNSIGNED NOT NULL DEFAULT 0,
          consecutive_failures INT UNSIGNED NOT NULL DEFAULT 0,
          total_runs INT UNSIGNED NOT NULL DEFAULT 0,
          empty_runs INT UNSIGNED NOT NULL DEFAULT 0,
          requires_javascript TINYINT(1) NOT NULL DEFAULT 0,
          blocked TINYINT(1) NOT NULL DEFAULT 0,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    })().catch((error) => {
      // Bir sonraki çağrı tekrar denesin; sağlık kaydı taramayı düşürmemeli.
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

/** Bir platformun tarama sonucunu kaydeder. */
export async function recordCrawlResult(status: PlatformCrawlStatus): Promise<void> {
  try {
    await ensureSourceHealthSchema();

    const pool = getDbPool();
    const succeeded = status.parsedListings > 0;

    // Engel/JS ipuçları mesajdan ve sayılardan çıkarılır: URL bulunup hiçbiri
    // parse edilemiyorsa sayfa büyük olasılıkla JavaScript ile doluyor.
    const blocked = /engel|blocked|cloudflare|captcha|403/i.test(status.message ?? "");
    const requiresJs = !succeeded && status.discoveredUrls === 0 && status.searchedUrls > 0;

    await pool.query(
      `INSERT INTO job_source_health
         (platform, last_status, last_message, last_checked_at, last_success_at,
          last_parsed_count, last_discovered_count, consecutive_failures,
          total_runs, empty_runs, requires_javascript, blocked)
       VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, 1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         last_status = VALUES(last_status),
         last_message = VALUES(last_message),
         last_checked_at = NOW(),
         last_success_at = IF(VALUES(last_parsed_count) > 0, NOW(), last_success_at),
         last_parsed_count = VALUES(last_parsed_count),
         last_discovered_count = VALUES(last_discovered_count),
         consecutive_failures = IF(VALUES(last_parsed_count) > 0, 0, consecutive_failures + 1),
         total_runs = total_runs + 1,
         empty_runs = empty_runs + IF(VALUES(last_parsed_count) > 0, 0, 1),
         requires_javascript = GREATEST(requires_javascript, VALUES(requires_javascript)),
         blocked = VALUES(blocked)`,
      [
        status.platform,
        status.status,
        (status.message ?? "").slice(0, 500) || null,
        succeeded ? new Date() : null,
        status.parsedListings,
        status.discoveredUrls,
        succeeded ? 0 : 1,
        succeeded ? 0 : 1,
        requiresJs ? 1 : 0,
        blocked ? 1 : 0
      ]
    );
  } catch (error) {
    // Sağlık kaydı bir teşhis aracıdır; yazılamaması aramayı durdurmamalı.
    console.warn(
      `[source-health] ${status.platform} kaydı yazılamadı:`,
      error instanceof Error ? error.message : error
    );
  }
}

export async function listSourceHealth(): Promise<SourceHealthRecord[]> {
  await ensureSourceHealthSchema();

  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT * FROM job_source_health ORDER BY consecutive_failures DESC, platform ASC"
  );

  return rows.map((row) => ({
    platform: String(row.platform) as JobPlatform,
    lastStatus: String(row.last_status) as PlatformCrawlStatus["status"],
    lastMessage: row.last_message ? String(row.last_message) : undefined,
    lastCheckedAt: new Date(row.last_checked_at).toISOString(),
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : undefined,
    lastParsedCount: Number(row.last_parsed_count ?? 0),
    lastDiscoveredCount: Number(row.last_discovered_count ?? 0),
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    totalRuns: Number(row.total_runs ?? 0),
    emptyRuns: Number(row.empty_runs ?? 0),
    requiresJavaScript: Boolean(row.requires_javascript),
    blocked: Boolean(row.blocked)
  }));
}

export type HealthVerdict = "saglikli" | "kismi" | "bozuk" | "engelli" | "bilinmiyor";

/** Kaydın tek kelimelik sağlık yargısı. */
export function verdictFor(record: SourceHealthRecord): HealthVerdict {
  if (record.blocked) {
    return "engelli";
  }

  if (!record.totalRuns) {
    return "bilinmiyor";
  }

  // Art arda üç başarısız tarama, geçici bir dalgalanma değil bozulmadır.
  if (record.consecutiveFailures >= 3) {
    return "bozuk";
  }

  const successRatio = (record.totalRuns - record.emptyRuns) / record.totalRuns;

  if (successRatio >= 0.7) {
    return "saglikli";
  }

  return successRatio > 0 ? "kismi" : "bozuk";
}

export const VERDICT_LABELS: Record<HealthVerdict, string> = {
  saglikli: "Sağlıklı",
  kismi: "Kısmi",
  bozuk: "Bozuk",
  engelli: "Engelli",
  bilinmiyor: "Bilinmiyor"
};
