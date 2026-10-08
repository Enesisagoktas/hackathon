import { computeFreshness, FRESHNESS_LABELS } from "../lib/jobs/freshness";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const NOW = new Date("2026-08-29T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3600 * 1000).toISOString();

console.log("\n═══ Tazelik ağırlığı (Feature #2) ═══\n");

console.log("1) Bantlar");
check("Bugünkü ilan +3 ve 'new'", (() => { const f = computeFreshness(daysAgo(0), NOW); return f.adjust === 3 && f.label === "new"; })());
check("3 günlük ilan +3", computeFreshness(daysAgo(3), NOW).adjust === 3);
check("5 günlük ilan +1 ve 'recent'", (() => { const f = computeFreshness(daysAgo(5), NOW); return f.adjust === 1 && f.label === "recent"; })());
check("14 günlük ilan nötr, rozetsiz", (() => { const f = computeFreshness(daysAgo(14), NOW); return f.adjust === 0 && f.label === null; })());
check("30 günlük ilan −2 ve 'old'", (() => { const f = computeFreshness(daysAgo(30), NOW); return f.adjust === -2 && f.label === "old"; })());

console.log("\n2) Tazelik uyumu DOMİNE EDEMEZ (şartname kuralı)");
const excellent = 85 + computeFreshness(daysAgo(15), NOW).adjust; // mükemmel + orta yaşlı
const poor = 45 + computeFreshness(daysAgo(0), NOW).adjust;       // zayıf + sıfır günlük
check("Mükemmel+eski > zayıf+yepyeni", excellent > poor, `${excellent} > ${poor}`);
const similar = 70 + computeFreshness(daysAgo(1), NOW).adjust;    // benzer uyum + taze
const similarOld = 70 + computeFreshness(daysAgo(30), NOW).adjust; // benzer uyum + eski
check("Benzer uyumda taze öne geçer", similar > similarOld, `${similar} > ${similarOld}`);
check("Toplam etki tavanı ±3/−2 (küçük etken)", Math.abs(computeFreshness(daysAgo(0), NOW).adjust) <= 3);

console.log("\n3) Temkin ilkesi — bilinmeyen tarih");
check("Tarih yoksa 0 ve rozetsiz", (() => { const f = computeFreshness(undefined, NOW); return f.adjust === 0 && f.label === null && f.ageDays === null; })());
check("Bozuk tarih 0 ve rozetsiz", (() => { const f = computeFreshness("dun aksam", NOW); return f.adjust === 0 && f.label === null; })());
check("Gelecek tarihli ilan bugünkü sayılır", computeFreshness(daysAgo(-2), NOW).ageDays === 0, "saat dilimi toleransı");
check("MySQL biçimi parse edilir", computeFreshness("2026-08-27 17:43:06", NOW).ageDays !== null, "cache'teki gerçek biçim");

console.log("\n4) Rozet etiketleri");
check("Üç etiketin Türkçesi tanımlı", FRESHNESS_LABELS.new === "Yeni" && FRESHNESS_LABELS.recent === "Güncel" && FRESHNESS_LABELS.old.length > 2);

console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
if (failed > 0) process.exitCode = 1;
