import "../lib/load-env";

import mysql from "mysql2/promise";

import { closeDbPool, getDbPool } from "../lib/db";
import { titleMatchesUrl } from "../lib/jobs/crawler";
import { dedupeListings } from "../lib/jobs/dedupe";
import { looksLikeBlockedPage } from "../lib/jobs/relevance";
import { listSourceHealth, VERDICT_LABELS, verdictFor } from "../lib/jobs/source-health";
import { listSources } from "../lib/jobs/source-registry";

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
  // Metrik, FİİLEN KULLANILAN havuzu ölçer: registry'de 'active' olmayan
  // kaynaklar (indirilen iyimser tohumlar, candidate'lar) rotasyona girmez ve
  // buraya sayılmaz — aksi hâlde hiç çalışmamış bir tohum sonsuza dek
  // "bozuk kaynak" olarak oranı aşağı çekerdi. Ayrıca en az 2 kez denenmiş
  // olma şartı aranır: tek taramalık geçmişle kaynak hakkında yargı verilmez.
  const sources = await listSourceHealth();
  const activeNames = new Set((await listSources("active").catch(() => [])).map((source) => source.name));
  const inUse = sources.filter(
    (s) => (activeNames.size === 0 || activeNames.has(String(s.platform))) && s.totalRuns >= 2
  );
  const healthy = inUse.filter((s) => {
    const v = verdictFor(s);
    return v === "saglikli" || v === "kismi";
  });

  report(
    "Çalışan kaynak oranı (aktif havuz, ≥2 tarama)",
    inUse.length
      ? `${healthy.length}/${inUse.length} (${inUse.map((s) => `${s.platform}: ${VERDICT_LABELS[verdictFor(s)]}`).join(", ")})`
      : "henüz yeterli tarama geçmişi yok",
    "en az yarısı",
    inUse.length === 0 || healthy.length * 2 >= inUse.length
  );

  // ── 5. Son aramaların sonuç kalitesi ──────────────────────────────────
  const [searches] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, results FROM job_searches
     WHERE status = 'completed' AND results IS NOT NULL AND JSON_LENGTH(results) > 0
     ORDER BY id DESC LIMIT 5`
  );

  let totalResults = 0;
  let withEligibility = 0;
  let rejectedListed = 0;
  let rejectedWithoutReason = 0;
  let orderViolations = 0;
  let top10Eligible = 0;
  let top10Total = 0;

  for (const row of searches) {
    const results = (typeof row.results === "string" ? JSON.parse(row.results) : row.results) as Array<{
      eligibility?: { eligible: boolean; blockers?: unknown[] };
      matchScore: number;
    }>;

    totalResults += results.length;
    let seenRejected = false;

    results.forEach((result, index) => {
      if (result.eligibility) {
        withEligibility += 1;

        if (!result.eligibility.eligible) {
          rejectedListed += 1;
          seenRejected = true;

          // Feature #3 sözleşmesi: elenen ilan ancak GEREKÇESİYLE listelenir.
          if (!Array.isArray(result.eligibility.blockers) || result.eligibility.blockers.length === 0) {
            rejectedWithoutReason += 1;
          }
        } else if (seenRejected) {
          // Uygun ilan, elenmiş bir ilanın ALTINA düşmüş: eligible-first ihlali.
          orderViolations += 1;
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
    const top10Rate = top10Total ? (top10Eligible / top10Total) * 100 : 0;

    report(
      "Uygunluk analizi kapsaması (son 5 arama)",
      `${withEligibility}/${totalResults} sonuç`,
      "tümü",
      withEligibility === totalResults,
      withEligibility > 0
    );
    // Feature #3 ile sözleşme değişti: elenen ilanlar artık BİLEREK listede
    // (gerekçeleriyle, başvuru kapısı ayrı). Ölçülen şey artık "listede elenen
    // yok" değil; "elenen varsa gerekçesi var ve uygunların altında" olmalı.
    report(
      "Elenen ilanlar gerekçeli ve uygunların altında",
      `${rejectedListed} elenen listelendi; ${rejectedWithoutReason} gerekçesiz, ${orderViolations} sıra ihlali`,
      "gerekçesiz 0, sıra ihlali 0",
      rejectedWithoutReason === 0 && orderViolations === 0
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

  // ── 5b. Kaynak çeşitliliği (§6) ve kaynak evreni (§3) ──
  const registry = await listSources().catch(() => []);
  const activeSources = registry.filter((source) => source.status === "active");
  const contributed = registry.filter((source) => source.newJobsFound > 0);

  report(
    "Kaynak evreni",
    `${registry.length} kaynak (${activeSources.length} aktif, ${contributed.length} ilan üretmiş)`,
    "büyüyen evren, ≥5 üretken kaynak",
    contributed.length >= 5,
    contributed.length >= 3
  );

  // Aktif cache'e katkı veren kaynak dağılımı: tek kaynağın payı %70'i aşmamalı.
  const [sourceDist] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT s.name, COUNT(*) n FROM job_listings l
     JOIN job_sources s ON s.id = l.source_id
     WHERE l.status = 'active' GROUP BY s.name ORDER BY n DESC`
  );
  const totalBySource = sourceDist.reduce((sum, row) => sum + Number(row.n), 0);
  const topShare = totalBySource ? Number(sourceDist[0]?.n ?? 0) / totalBySource : 0;

  report(
    "Kaynak çeşitliliği (cache)",
    sourceDist.length
      ? `${sourceDist.length} kaynak; en büyük pay ${sourceDist[0].name} %${Math.round(topShare * 100)}`
      : "veri yok",
    "tek kaynak ≤70%",
    sourceDist.length >= 3 && topShare <= 0.7,
    topShare <= 0.85
  );

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
