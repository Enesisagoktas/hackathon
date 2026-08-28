import "../lib/load-env";

import mysql from "mysql2/promise";

import { closeDbPool, getDbPool } from "../lib/db";
import { titleMatchesUrl } from "../lib/jobs/crawler";
import { dedupeListings } from "../lib/jobs/dedupe";
import { looksLikeBlockedPage } from "../lib/jobs/relevance";
import { listSourceHealth, VERDICT_LABELS, verdictFor } from "../lib/jobs/source-health";

/**
 * §24 — Sistemi "kaç ilan buldu?" ile değil kalite metrikleriyle ölçer.
 *
 * Her metrik gerçek veritabanı verisinden hesaplanır; hedefler şartnameden
 * gelir. Bir metrik hedefin altındaysa rapor bunu açıkça söyler — sorunun
 * görünmez kalması, var olmasından daha tehlikelidir.
 *
 * Kullanım: npm run quality
 */

type MetricRow = {
  metrik: string;
  deger: string;
  hedef: string;
  durum: "✓" | "⚠" | "✗";
};

const rows: MetricRow[] = [];

function report(metrik: string, deger: string, hedef: string, ok: boolean, warn = false) {
  rows.push({ metrik, deger, hedef, durum: ok ? "✓" : warn ? "⚠" : "✗" });
}

async function main() {
  const pool = getDbPool();

  console.log("\n═══ CVMatch kalite raporu ═══");

  // ── 1. Yanlış ilan oranı: aktif kayıtlar arasında sahte/bozuk var mı? ──
  const [active] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, title, company, location, description, external_url FROM job_listings WHERE status = 'active'"
  );

  const blocked = active.filter((row) =>
    looksLikeBlockedPage(String(row.title ?? ""), String(row.description ?? ""))
  );
  const crossed = active.filter(
    (row) =>
      !looksLikeBlockedPage(String(row.title ?? ""), String(row.description ?? "")) &&
      !titleMatchesUrl(String(row.title ?? ""), String(row.external_url ?? ""))
  );
  const badCount = blocked.length + crossed.length;
  const badRate = active.length ? (badCount / active.length) * 100 : 0;

  report(
    "Yanlış ilan oranı (engel sayfası + çapraz başlık)",
    `${badCount}/${active.length} (%${badRate.toFixed(1)})`,
    "%2'nin altı",
    badRate < 2,
    badRate < 5
  );

  // ── 2. Duplicate oranı ─────────────────────────────────────────────────
  const dedupable = active.map((row) => ({
    url: String(row.external_url ?? ""),
    title: String(row.title ?? ""),
    company: row.company ? String(row.company) : undefined,
    location: row.location ? String(row.location) : undefined,
    description: row.description ? String(row.description) : undefined
  }));
  const dupOutcome = dedupeListings(dedupable);
  const dupRate = active.length ? (dupOutcome.removed / active.length) * 100 : 0;

  report(
    "Cache'te kopya ilan oranı",
    `${dupOutcome.removed}/${active.length} (%${dupRate.toFixed(1)})`,
    "%5'in altı",
    dupRate < 5,
    dupRate < 10
  );

  // ── 3. Aktiflik: aktif kayıtlar ne kadar taze doğrulanmış? ────────────
  const [staleCheck] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
       SUM(last_checked_at IS NULL OR last_checked_at < DATE_SUB(NOW(), INTERVAL 7 DAY)) AS stale,
       COUNT(*) AS total
     FROM job_listings WHERE status = 'active'`
  );
  const staleCount = Number(staleCheck[0]?.stale ?? 0);
  const totalActive = Number(staleCheck[0]?.total ?? 0);
  const freshRate = totalActive ? ((totalActive - staleCount) / totalActive) * 100 : 0;

  report(
    "Son 7 günde doğrulanan aktif ilan oranı",
    `${totalActive - staleCount}/${totalActive} (%${freshRate.toFixed(0)})`,
    "%50'nin üstü",
    freshRate >= 50,
    freshRate >= 25
  );

  // ── 4. Kaynak başarı oranı ────────────────────────────────────────────
  const sources = await listSourceHealth();
  const healthy = sources.filter((s) => {
    const v = verdictFor(s);
    return v === "saglikli" || v === "kismi";
  });

  report(
    "Çalışan kaynak oranı",
    sources.length
      ? `${healthy.length}/${sources.length} (${sources.map((s) => `${s.platform}: ${VERDICT_LABELS[verdictFor(s)]}`).join(", ")})`
      : "veri yok",
    "en az yarısı",
    sources.length > 0 && healthy.length * 2 >= sources.length
  );

  // ── 5. Son aramaların sonuç kalitesi ──────────────────────────────────
  const [searches] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, results FROM job_searches
     WHERE status = 'completed' AND results IS NOT NULL AND JSON_LENGTH(results) > 0
     ORDER BY id DESC LIMIT 5`
  );

  let totalResults = 0;
  let withEligibility = 0;
  let eligibleCount = 0;
  let top10Eligible = 0;
  let top10Total = 0;

  for (const row of searches) {
    const results = (typeof row.results === "string" ? JSON.parse(row.results) : row.results) as Array<{
      eligibility?: { eligible: boolean };
      matchScore: number;
    }>;

    totalResults += results.length;

    results.forEach((result, index) => {
      if (result.eligibility) {
        withEligibility += 1;
        if (result.eligibility.eligible) {
          eligibleCount += 1;
        }
        if (index < 10) {
          top10Total += 1;
          if (result.eligibility.eligible) {
            top10Eligible += 1;
          }
        }
      }
    });
  }

  if (totalResults) {
    const eligibleRate = withEligibility ? (eligibleCount / withEligibility) * 100 : 0;
    const top10Rate = top10Total ? (top10Eligible / top10Total) * 100 : 0;

    report(
      "Uygunluk analizi kapsaması (son 5 arama)",
      `${withEligibility}/${totalResults} sonuç`,
      "tümü",
      withEligibility === totalResults,
      withEligibility > 0
    );
    report(
      "Listelenen ilanların hard filter'ı geçme oranı",
      `${eligibleCount}/${withEligibility} (%${eligibleRate.toFixed(0)})`,
      "%100 (uygun olmayan listelenmez)",
      eligibleRate === 100,
      eligibleRate >= 90
    );
    report(
      "İlk 10 sonucun kalitesi",
      `${top10Eligible}/${top10Total} uygun (%${top10Rate.toFixed(0)})`,
      "%100",
      top10Rate === 100,
      top10Rate >= 90
    );
  } else {
    report("Son arama sonuçları", "tamamlanan arama yok", "en az 1", false, true);
  }

  // ── 6. Başvuru sağlığı ────────────────────────────────────────────────
  const [apps] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT status, COUNT(*) n,
            SUM(pdf_path IS NOT NULL OR docx_path IS NOT NULL) with_files
     FROM job_applications GROUP BY status`
  );

  const byStatus = new Map(apps.map((row) => [String(row.status), Number(row.n)]));
  const failed = byStatus.get("failed") ?? 0;
  const totalApps = apps.reduce((sum, row) => sum + Number(row.n), 0);
  const failRate = totalApps ? (failed / totalApps) * 100 : 0;

  report(
    "Başvuru hata oranı",
    `${failed}/${totalApps} (%${failRate.toFixed(1)})`,
    "%5'in altı",
    failRate < 5,
    failRate < 10
  );

  const prepared = apps
    .filter((row) => !["skipped", "failed"].includes(String(row.status)))
    .reduce((sum, row) => sum + Number(row.n), 0);
  const preparedWithFiles = apps
    .filter((row) => !["skipped", "failed"].includes(String(row.status)))
    .reduce((sum, row) => sum + Number(row.with_files ?? 0), 0);

  report(
    "CV dosyası olan başvuru paketi oranı",
    `${preparedWithFiles}/${prepared}`,
    "tümü",
    prepared === 0 || preparedWithFiles === prepared,
    prepared > 0 && preparedWithFiles / prepared >= 0.9
  );

  // ── Çıktı ─────────────────────────────────────────────────────────────
  console.log("");
  console.table(rows);

  const failures = rows.filter((row) => row.durum === "✗");
  const warnings = rows.filter((row) => row.durum === "⚠");

  if (failures.length) {
    console.log(`✗ ${failures.length} metrik hedefin altında:`);
    failures.forEach((row) => console.log(`   • ${row.metrik}: ${row.deger} (hedef: ${row.hedef})`));
  }
  if (warnings.length) {
    console.log(`⚠ ${warnings.length} metrik sınırda.`);
  }
  if (!failures.length && !warnings.length) {
    console.log("✓ Tüm kalite metrikleri hedefte.");
  }
  console.log("");

  if (failures.length) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Kalite raporu çöktü:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDbPool().catch(() => undefined));
