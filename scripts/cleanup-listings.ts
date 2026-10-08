import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { closeDbPool, getDbPool } from "../lib/db";
import { titleMatchesUrl } from "../lib/jobs/crawler";
import { looksLikeBlockedPage, looksLikeNonJobPage } from "../lib/jobs/relevance";
import type mysql from "mysql2/promise";

/**
 * Cache'e sızmış sahte ilanları kapatır.
 *
 * Engel/hata sayfası tespiti crawler'a sonradan eklendi; ondan önce kaydedilen
 * kayıtlar veritabanında duruyor. Ölçüm: 20 kayıt "Sorry, you have been
 * blocked" başlığıyla aktif görünüyordu — bunlar Yenibiriş'in Cloudflare
 * sayfasının ilan sanılmış hâli.
 *
 * Kayıtlar SİLİNMEZ, 'expired' işaretlenir: başvuru kayıtları bunlara referans
 * verebilir ve geçmiş korunmalıdır. Bekleyen başvuru paketleri de kapatılır.
 */

const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  const pool = getDbPool();

  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, title, description, external_url FROM job_listings WHERE status IN ('active', 'stale')"
  );

  const doomed = rows.filter((row) => {
    const title = String(row.title ?? "");

    if (looksLikeBlockedPage(title, String(row.description ?? ""))) {
      return true;
    }

    // İlan olmayan içerik: maaş istatistiği, şirket profili (Indeed /salaries).
    if (looksLikeNonJobPage(title, String(row.external_url ?? ""))) {
      return true;
    }

    // Başlığı URL'siyle hiç örtüşmeyen kayıtlar: crawler, <h1> bulunmayan
    // sayfalarda listeden BAŞKA bir ilanın başlığını alıyordu (Toptalent).
    return !titleMatchesUrl(title, String(row.external_url ?? ""));
  });

  console.log(`\nTaranan: ${rows.length} ilan | sahte bulunan: ${doomed.length}\n`);

  if (!doomed.length) {
    console.log("Temizlenecek kayıt yok.");
    return;
  }

  const counts = new Map<string, number>();
  for (const row of doomed) {
    const title = String(row.title ?? "").slice(0, 55);
    const reason = looksLikeBlockedPage(title, String(row.description ?? ""))
      ? "engel sayfası"
      : looksLikeNonJobPage(title, String(row.external_url ?? ""))
        ? "ilan değil (maaş/profil sayfası)"
        : "başlık–URL uyuşmuyor";
    const key = `[${reason}] ${title}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  for (const [title, count] of Array.from(counts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)} × ${title}`);
  }

  if (DRY_RUN) {
    console.log(`\nPROVA MODU — hiçbir şey değiştirilmedi. Uygulamak için: npm run cleanup:listings -- --apply\n`);
    return;
  }

  const ids = doomed.map((row) => Number(row.id));
  const placeholders = ids.map(() => "?").join(", ");

  const [appResult] = await pool.query<mysql.ResultSetHeader>(
    `UPDATE job_applications
        SET status = 'skipped', error_message = 'İlan kaydı geçersiz (engel sayfası veya yanlış başlık).', updated_at = NOW()
      WHERE listing_id IN (${placeholders})
        AND status IN ('needs_review', 'manual_required', 'queued', 'preparing')`,
    ids
  );

  const [listingResult] = await pool.query<mysql.ResultSetHeader>(
    `UPDATE job_listings
        SET status = 'expired', last_checked_at = NOW(), updated_at = NOW()
      WHERE id IN (${placeholders})`,
    ids
  );

  console.log(`\n${listingResult.affectedRows} ilan kapatıldı, ${appResult.affectedRows} bekleyen başvuru iptal edildi.\n`);
}

/**
 * Şirket alanına düşmüş site arayüz metinlerini temizler.
 *
 * Ölçüm: Eleman.net'te 17 ilan "İş İlanı Ver" (menü düğmesi), Toptalent'te
 * kayıtlar "İşveren Girişi" şirket adıyla kaydedilmişti. Crawler artık
 * bunları yakalıyor; buradaki adım eski kayıtları onarır. İlanlar GERÇEK,
 * yalnızca şirket alanı bozuk — bu yüzden kapatılmaz, alan boşaltılır.
 */
async function clearBogusCompanies(): Promise<void> {
  const pool = getDbPool();
  const bogus = ["İş İlanı Ver", "İş İlanları", "İşveren Girişi", "Firma Adı Gizli", "Firma Girişi", "Giriş Yap", "Üye Ol", "Ücretsiz İş İlanı Ver"];
  const placeholders = bogus.map(() => "?").join(", ");

  if (DRY_RUN) {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT company, COUNT(*) n FROM job_listings WHERE company IN (${placeholders}) GROUP BY company`,
      bogus
    );
    if (rows.length) {
      console.log("Sahte şirket adları (PROVA — temizlenecek):");
      rows.forEach((row) => console.log(`  ${row.n} × "${row.company}"`));
    }
    return;
  }

  const [result] = await pool.query<mysql.ResultSetHeader>(
    `UPDATE job_listings SET company = NULL, updated_at = NOW() WHERE company IN (${placeholders})`,
    bogus
  );

  if (result.affectedRows) {
    console.log(`${result.affectedRows} kayıtta sahte şirket adı temizlendi.`);
  }
}

main()
  .then(() => clearBogusCompanies())
  .catch((error) => {
    console.error("Temizlik başarısız:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDbPool().catch(() => undefined));
