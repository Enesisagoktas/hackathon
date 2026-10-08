import { VERDICT_LABELS, verdictFor, type SourceHealthRecord } from "../lib/jobs/source-health";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const base: SourceHealthRecord = {
  platform: "Kariyer.net" as SourceHealthRecord["platform"],
  lastStatus: "success",
  lastCheckedAt: "2026-08-28T00:00:00.000Z",
  lastParsedCount: 4,
  lastDiscoveredCount: 6,
  consecutiveFailures: 0,
  totalRuns: 10,
  emptyRuns: 1,
  requiresJavaScript: false,
  blocked: false
};

console.log("\n═══ Kaynak sağlık yargısı ═══\n");

console.log("1) Sağlıklı kaynak");
check("Yüksek başarı → sağlıklı", verdictFor(base) === "saglikli", VERDICT_LABELS[verdictFor(base)]);

console.log("\n2) Bozulma tespiti");
check(
  "Üst üste 3 hata → bozuk",
  verdictFor({ ...base, consecutiveFailures: 3 }) === "bozuk",
  "geçici dalgalanma değil, bozulma"
);
check("Üst üste 2 hata henüz bozuk değil", verdictFor({ ...base, consecutiveFailures: 2 }) !== "bozuk");
check(
  "Hiç başarı yoksa bozuk",
  verdictFor({ ...base, totalRuns: 5, emptyRuns: 5, consecutiveFailures: 1 }) === "bozuk"
);
check(
  "Yarı yarıya başarı → kısmi",
  verdictFor({ ...base, totalRuns: 10, emptyRuns: 5 }) === "kismi",
  VERDICT_LABELS[verdictFor({ ...base, totalRuns: 10, emptyRuns: 5 })]
);

console.log("\n3) Güvenlik engeli her şeyin önünde");
check(
  "Engelli kaynak engelli işaretlenir",
  verdictFor({ ...base, blocked: true }) === "engelli",
  "başarı oranı yüksek olsa bile"
);

console.log("\n4) Veri yoksa yargı verilmez");
check("Hiç tarama yoksa bilinmiyor", verdictFor({ ...base, totalRuns: 0 }) === "bilinmiyor");

console.log("\n5) Etiketler eksiksiz");
check(
  "Her yargının Türkçe etiketi var",
  (["saglikli", "kismi", "bozuk", "engelli", "bilinmiyor"] as const).every((k) => VERDICT_LABELS[k]?.length > 2)
);

console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
if (failed > 0) process.exitCode = 1;
