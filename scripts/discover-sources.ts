import "../lib/load-env";

import { closeDbPool } from "../lib/db";
import { runDiscoveryCycle } from "../lib/jobs/source-discovery";
import { listSources } from "../lib/jobs/source-registry";

/**
 * Kaynak keşif turu (§2): cache'teki şirketlerden ATS board'ları arar,
 * candidate kaynakları doğrular. Zamanlanmış çalıştırılabilir.
 *
 * Kullanım: npm run discover:sources
 */
async function main() {
  console.log("\n═══ Kaynak keşfi ═══\n");

  const outcome = await runDiscoveryCycle({ maxProbes: 20 });

  console.log(`Yoklanan: ${outcome.probed} | kaydedilen: ${outcome.registered} | aktifleşen: ${outcome.activated} | başarısız: ${outcome.failed}`);

  if (outcome.notes.length) {
    console.log("\nNotlar:");
    outcome.notes.forEach((note) => console.log(`  • ${note}`));
  }

  const all = await listSources();
  const byStatus = new Map<string, number>();
  all.forEach((source) => byStatus.set(source.status, (byStatus.get(source.status) ?? 0) + 1));

  console.log(
    `\nEvren: ${all.length} kaynak (${Array.from(byStatus.entries())
      .map(([status, count]) => `${status}=${count}`)
      .join(", ")})`
  );
}

main()
  .catch((error) => {
    console.error("Keşif çöktü:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDbPool().catch(() => undefined));
