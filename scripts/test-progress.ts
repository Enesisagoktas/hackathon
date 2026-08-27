import {
  applyStageUpdate,
  createProgress,
  parseProgress,
  progressPercent,
  STAGE_ORDER
} from "../lib/jobs/progress";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const T = "2026-08-28T10:00:00.000Z";
console.log("\n═══ Arama ilerleme göstergesi ═══\n");

console.log("1) Başlangıç");
const p0 = createProgress(T);
check("Tüm aşamalar listeleniyor", p0.stages.length === STAGE_ORDER.length, `${p0.stages.length} aşama`);
check("Hepsi beklemede", p0.stages.every((s) => s.status === "pending"));
check("Sayaçlar sıfır", p0.counters.found === 0 && p0.counters.eligible === 0);
check("Başlangıç yüzdesi 0", progressPercent(p0) === 0);

console.log("\n2) Aşama ilerletme");
const p1 = applyStageUpdate(p0, { key: "plan", status: "running" }, T);
check("Aşama çalışıyor işaretlendi", p1.stages[0].status === "running");
check("Yüzde arttı", progressPercent(p1) > 0, `%${progressPercent(p1)}`);

const p2 = applyStageUpdate(p1, { key: "primary-search", status: "running", detail: "3 kaynak" }, T, { found: 12 });
check("Önceki aşama otomatik kapandı", p2.stages[0].status === "done", "worker geriye dönük kapatma yapmak zorunda değil");
check("Detay yazıldı", p2.stages[1].detail === "3 kaynak");
check("Sayaç güncellendi", p2.counters.found === 12);

console.log("\n3) Sayaçlar birikimli güncelleniyor");
const p3 = applyStageUpdate(p2, { key: "verify", status: "running" }, T, { verified: 8, eliminated: 4 });
check("Yeni sayaçlar yazıldı", p3.counters.verified === 8 && p3.counters.eliminated === 4);
check("Eski sayaç korundu", p3.counters.found === 12, "found=12 kayıp değil");

console.log("\n4) Yüzde asla %100'de takılı kalmaz (iş bitmeden)");
let full = createProgress(T);
for (const key of STAGE_ORDER) full = applyStageUpdate(full, { key, status: "done" }, T);
check("Tamamlanınca %99", progressPercent(full) === 99, `%${progressPercent(full)} — bitişi worker 100 yapar`);

console.log("\n5) Atlanan aşama tamamlanmış sayılır");
const skipped = applyStageUpdate(createProgress(T), { key: "boutique-search", status: "skipped", detail: "süre yetmedi" }, T);
check("Atlanan aşama yüzdeye sayılır", progressPercent(skipped) > 0);
check("Sebebi yazılı", skipped.stages.find((s) => s.key === "boutique-search")?.detail === "süre yetmedi");

console.log("\n6) Kayıttan okuma dayanıklı");
check("Boş değer null döner", parseProgress(null, T) === null);
check("Bozuk JSON null döner", parseProgress("{bozuk", T) === null);
check("Dizi olmayan null döner", parseProgress({ stages: "x" }, T) === null);

const partial = parseProgress({ stages: [{ key: "plan", label: "x", status: "done" }], counters: { found: 5 } }, T);
check("Eksik aşamalar tamamlanır", partial?.stages.length === STAGE_ORDER.length, `${partial?.stages.length} aşama`);
check("Var olan aşama korunur", partial?.stages[0].status === "done");
check("Eksik sayaçlar sıfırlanır", partial?.counters.eligible === 0 && partial?.counters.found === 5);

const roundTrip = parseProgress(JSON.stringify(p3), T);
check("JSON gidiş-dönüş bozulmuyor", roundTrip?.counters.found === 12 && roundTrip?.counters.verified === 8);

console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
if (failed > 0) process.exitCode = 1;
