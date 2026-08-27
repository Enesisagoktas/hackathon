import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { closeDbPool } from "../lib/db";
import { listSourceHealth, VERDICT_LABELS, verdictFor } from "../lib/jobs/source-health";

/** §6 — Hangi ilan kaynağı çalışıyor, hangisi sessizce bozuldu? */
async function main() {
  const records = await listSourceHealth();

  if (!records.length) {
    console.log("\nHenüz kaynak sağlık kaydı yok. Bir tarama çalıştırın: npm run crawl:jobs\n");
    return;
  }

  console.log(`\n═══ Kaynak sağlığı (${records.length} kaynak) ═══\n`);

  const rows = records.map((record) => ({
    kaynak: record.platform,
    durum: VERDICT_LABELS[verdictFor(record)],
    "son ilan": record.lastParsedCount,
    "son URL": record.lastDiscoveredCount,
    "üst üste hata": record.consecutiveFailures,
    "boş/toplam": `${record.emptyRuns}/${record.totalRuns}`,
    JS: record.requiresJavaScript ? "evet" : "",
    engel: record.blocked ? "EVET" : ""
  }));

  console.table(rows);

  const broken = records.filter((r) => verdictFor(r) === "bozuk" || verdictFor(r) === "engelli");

  if (broken.length) {
    console.log("Dikkat gerektirenler:");
    for (const record of broken) {
      console.log(`  • ${record.platform} (${VERDICT_LABELS[verdictFor(record)]}): ${record.lastMessage ?? "—"}`);
    }
    console.log("");
  }
}

main()
  .catch((error) => {
    console.error("Rapor başarısız:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDbPool().catch(() => undefined));
