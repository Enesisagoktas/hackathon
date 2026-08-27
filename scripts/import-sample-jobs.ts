import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";

import { closeDbPool } from "../lib/db";
import { countActiveListings, importSampleJobs, type SampleJob } from "../lib/jobs/repository";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

/**
 * Seeds the DB cache with realistic demo listings so the app works end-to-end
 * even when the live crawler has never run. Idempotent: re-running upserts.
 */
/**
 * UYARI: data/sample-jobs.json içindeki ilanların URL'leri GERÇEK DEĞİLDİR.
 * Kullanıcı "İlanı Aç" dediğinde bu linkler 404 verir veya sitenin arama
 * sayfasına yönlenir. Bu yüzden seed yalnızca açıkça istendiğinde çalışır:
 *
 *   npm run seed:jobs -- --demo
 *
 * Gerçek ilanlar için `npm run crawl:jobs` kullanın.
 */
function ensureDemoFlag(): boolean {
  if (process.argv.includes("--demo") || process.env.ALLOW_SAMPLE_JOBS === "true") {
    return true;
  }

  console.error(
    [
      "",
      "[seed:jobs] ATLANDI — örnek ilanların URL'leri gerçek değil ve kullanıcıya ölü link gösterir.",
      "  Gerçek ilan için:      npm run crawl:jobs",
      "  Yine de yüklemek için: npm run seed:jobs -- --demo",
      ""
    ].join("\n")
  );
  return false;
}

async function run() {
  if (!ensureDemoFlag()) {
    return;
  }

  try {
    const dataPath = path.resolve(process.cwd(), "data/sample-jobs.json");
    const raw = await fs.readFile(dataPath, "utf-8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error("data/sample-jobs.json bir dizi (array) olmalı.");
    }

    const jobs = parsed as SampleJob[];
    console.log(`[seed:jobs] ${jobs.length} örnek ilan içe aktarılıyor...`);

    const imported = await importSampleJobs(jobs);
    const activeCount = await countActiveListings();

    console.log(`[seed:jobs] ${imported} ilan upsert edildi.`);
    console.log(`[seed:jobs] Toplam aktif ilan sayısı: ${activeCount}`);

    if (activeCount === 0) {
      throw new Error("Seed sonrası aktif ilan bulunamadı.");
    }
  } catch (error) {
    console.error("[seed:jobs] Hata:", error instanceof Error ? error.message : error);
    console.error("[seed:jobs] Önce `npm run migrate` çalıştırdığınızdan emin olun.");
    process.exitCode = 1;
  } finally {
    await closeDbPool().catch(() => undefined);
  }
}

run();
