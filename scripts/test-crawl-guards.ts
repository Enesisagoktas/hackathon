import { hasFallenBackToGenericListing } from "../lib/jobs/crawler";

/**
 * Canlı ölçümle bulunan durum: `kariyer.net/is-ilanlari/frontend-developer`
 * 302 ile `/is-ilanlari` (tüm ilanlar) sayfasına düşüyor, `?k=` parametresi
 * sunucuda siliniyor. Crawler bu sayfaları geçerli arama sonucu sanıp garson /
 * satış temsilcisi ilanlarını "Frontend Developer" sorgusuyla kaydediyordu.
 */

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n═══ Arama sayfası yönlendirme koruması ═══\n");

console.log("1) Ölçümde birebir görülen yönlendirmeler");
check(
  "Slug araması genel listeye düşerse yakalanır",
  hasFallenBackToGenericListing(
    "https://www.kariyer.net/is-ilanlari/frontend-developer",
    "https://www.kariyer.net/is-ilanlari"
  ),
  "/is-ilanlari/frontend-developer → /is-ilanlari"
);
check(
  "Arama parametresi düşerse yakalanır",
  hasFallenBackToGenericListing(
    "https://www.kariyer.net/is-ilanlari?fpi=1&k=frontend+developer",
    "https://www.kariyer.net/is-ilanlari?fpi=1"
  ),
  "k parametresi silindi"
);

console.log("\n2) Geçerli arama sayfaları engellenmemeli");
check(
  "Yönlendirme yoksa sorun yok",
  !hasFallenBackToGenericListing(
    "https://www.kariyer.net/is-ilanlari/yazilim-gelistirici",
    "https://www.kariyer.net/is-ilanlari/yazilim-gelistirici"
  ),
  "ölçümde 146 eşleşme veren çalışan URL"
);
check(
  "Sondaki eğik çizgi farkı sorun değil",
  !hasFallenBackToGenericListing(
    "https://www.secretcv.com/is-ilanlari/frontend-developer-is-ilanlari",
    "https://www.secretcv.com/is-ilanlari/frontend-developer-is-ilanlari/"
  )
);
check(
  "http→https yükseltmesi sorun değil",
  !hasFallenBackToGenericListing("http://www.eleman.net/is-ilanlari/hemsire", "https://www.eleman.net/is-ilanlari/hemsire")
);
check(
  "Sitenin parametre eklemesi sorun değil",
  !hasFallenBackToGenericListing(
    "https://www.kariyer.net/is-ilanlari?kw=hemsire",
    "https://www.kariyer.net/is-ilanlari?kw=hemsire&sayfa=1"
  )
);
check(
  "Daha derin bir yola yönlendirme sorun değil",
  !hasFallenBackToGenericListing(
    "https://www.eleman.net/is-ilanlari/hemsire",
    "https://www.eleman.net/is-ilanlari/hemsire/istanbul"
  )
);

console.log("\n3) Başka siteye çıkış");
check(
  "Farklı alan adına yönlendirme reddedilir",
  hasFallenBackToGenericListing("https://www.kariyer.net/is-ilanlari/hemsire", "https://www.baskasite.com/kampanya"),
  "oltalama / reklam yönlendirmesi"
);

console.log("\n4) Bozuk girdi çökertmez");
check("Geçersiz URL sessizce geçilir", !hasFallenBackToGenericListing("bu-url-degil", "bu-da-degil"));
check("Boş son URL sorun sayılmaz", !hasFallenBackToGenericListing("https://www.kariyer.net/is-ilanlari/hemsire", ""));

console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
if (failed > 0) process.exitCode = 1;
