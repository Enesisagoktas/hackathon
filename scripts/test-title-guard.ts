import { titleMatchesUrl } from "../lib/jobs/crawler";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n═══ Başlık–URL tutarlılık denetimi ═══\n");

console.log("1) Veritabanındaki gerçek çaprazlanma (Toptalent)");
check(
  "Yanlış eşleşme yakalanır",
  !titleMatchesUrl("Satış Stajyeri DÖHLER İstanbul Anadolu", "https://toptalent.co/toptalent-sosyal-medya-uzmani-donemsel-121721"),
  "başlık 'Satış Stajyeri' ama URL 'sosyal-medya-uzmani'"
);
check(
  "Doğru eşleşme kabul edilir",
  titleMatchesUrl("Genel Muhasebe Uzmanı - FASDAT", "https://toptalent.co/fasdat-genel-muhasebe-uzmani-121693")
);

console.log("\n2) Türkçe karakter ve ek toleransı");
check(
  "Türkçe karakterler normalize edilir",
  titleMatchesUrl("Front-End Geliştirici", "https://www.kariyer.net/is-ilani/camlica-front-end-gelistirici-4526749"),
  "Geliştirici ↔ gelistirici"
);
check(
  "Şirket adı üzerinden eşleşir",
  titleMatchesUrl("Arayüz Yazılım Uzmanı MerIT Bilişim", "https://www.kariyer.net/is-ilani/merit-bilisim-arayuz-yazilim-uzmani-4542362")
);

console.log("\n3) Karar verilemeyen durumlarda başlık reddedilmez");
check("Kısa/ayırt edici olmayan başlık kabul edilir", titleMatchesUrl("Garson", "https://x.com/is-ilani/12345"));
check("Slug'ı olmayan URL kabul edilir", titleMatchesUrl("Yazılım Geliştirici", "https://x.com/1234"));
check("Bozuk URL çökertmez", titleMatchesUrl("Yazılım Geliştirici", "bu-url-degil"));
check("Boş başlık kabul edilir", titleMatchesUrl("", "https://x.com/is-ilani/yazilim-gelistirici"));

console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
if (failed > 0) process.exitCode = 1;
