import { buildProfileTerms, filterListingsByProfile, isListingRelatedToProfile, looksLikeBlockedPage } from "../lib/jobs/relevance";
import type { CandidateProfile, CrawledJobListing } from "../lib/jobs/types";

/**
 * İlan siteleri arama sonucu bulamayınca genel ilan listesini döner; crawler
 * o sayfadaki her ilanı kaydeder. Ölçüm: DB'de "Senior Frontend Developer"
 * etiketli 50 ilan vardı, hiçbirinin başlığında "developer" yoktu.
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

const frontend = {
  targetRole: "Senior Frontend Developer",
  titles: ["Frontend Developer", "Web Geliştirici"],
  skills: ["React", "Next.js", "TypeScript", "JavaScript"],
  languages: [],
  industries: ["Yazılım"],
  experienceAreas: ["Web geliştirme"],
  keywords: ["react", "frontend"],
  locations: [],
  locationMode: "all-turkey",
  workMode: "any"
} as CandidateProfile;

const nurse = {
  targetRole: "Servis Sorumlu Hemşiresi",
  titles: ["Hemşire", "Sorumlu Hemşire"],
  skills: ["Yoğun bakım", "Hasta bakımı", "İlaç uygulama"],
  languages: [],
  industries: ["Sağlık"],
  experienceAreas: ["Klinik hemşirelik"],
  keywords: ["hemşire", "hasta"],
  locations: [],
  locationMode: "all-turkey",
  workMode: "any"
} as CandidateProfile;

function listing(title: string, description = ""): CrawledJobListing {
  return {
    platform: "Kariyer.net",
    category: "general",
    title,
    description,
    url: `https://example.com/${encodeURIComponent(title)}`,
    sourceQuery: "test"
  } as CrawledJobListing;
}

console.log("\n═══ İlan-profil ilgi kapısı ═══\n");

console.log("1) Profilden ayırt edici kelime çıkarma");
const feTerms = buildProfileTerms(frontend);
check("Beceri kelimeleri alınır", feTerms.includes("react") && feTerms.includes("typescript"));
check("Türkçe unvan normalize edilir", feTerms.includes("gelistirici"), "Geliştirici → gelistirici");
check("'senior' gibi kıdem eki ayırt edici sayılmaz", !feTerms.includes("senior"));
check("Tek başına 'developer' ayırt edici sayılmaz", !feTerms.includes("developer"));
check("Hemşire profili kendi kelimelerini üretir", buildProfileTerms(nurse).includes("hemsire"));

console.log("\n2) Kullanıcının bildirdiği gerçek kirlilik (DB'den birebir başlıklar)");
const polluted = [
  listing("Garson"),
  listing("Çağrı Merkezi Müşteri Temsilcisi"),
  listing("Engelli Satış Temsilcisi - İstanbul Avrupa Yakası"),
  listing("Grafik Tasarımcı O.G.S. END ELEKT ELETRON İTH İHR PAZ SAN"),
  listing("Duty Manager")
];
polluted.forEach((item) => {
  check(`Elenir: ${item.title.slice(0, 40)}`, !isListingRelatedToProfile(item, feTerms));
});

console.log("\n3) Gerçek eşleşmeler korunur");
const genuine = [
  listing("Frontend Developer"),
  listing("Yazılım Geliştirici", "React ve TypeScript ile arayüz geliştirme"),
  listing("Kıdemli Önyüz Geliştirici", "Next.js deneyimi aranmaktadır"),
  listing("Satış Uzmanı", "React ve TypeScript bilen ürün ekibine destek verecek") // metinde İKİ kelime kesişiyor
];
genuine.forEach((item) => {
  check(`Tutulur: ${item.title.slice(0, 40)}`, isListingRelatedToProfile(item, feTerms));
});

console.log("\n4) Hemşire profili — kullanıcının şikayet ettiği senaryo");
const nurseTerms = buildProfileTerms(nurse);
check("Ofis personeli ilanı elenir", !isListingRelatedToProfile(listing("Ofis Personeli"), nurseTerms));
check("Muhasebe uzmanı elenir", !isListingRelatedToProfile(listing("Muhasebe Uzmanı"), nurseTerms));
check("Yoğun bakım hemşiresi tutulur", isListingRelatedToProfile(listing("Yoğun Bakım Hemşiresi"), nurseTerms));
check(
  "Sağlık teknikeri ilanı metninde hemşire geçiyorsa tutulur",
  isListingRelatedToProfile(listing("Sağlık Teknikeri", "Hemşire ekibiyle birlikte çalışacak"), nurseTerms)
);

console.log("\n5) Tamamı alakasız olan platform sıfır döndürmeli");
const allIrrelevant = filterListingsByProfile([listing("Garson"), listing("Şoför")], frontend);
check(
  "Hiçbiri uymuyorsa hiçbiri alınmaz",
  allIrrelevant.kept.length === 0 && allIrrelevant.dropped.length === 2,
  "ölçümde Eleman.net'in 4 alakasız ilanı böyle sızıyordu"
);

const mixed = filterListingsByProfile([listing("Frontend Developer"), listing("Garson"), listing("Şoför")], frontend);
check("Karışık listede yalnız alakasızlar elenir", mixed.kept.length === 1 && mixed.dropped.length === 2, `kept=${mixed.kept.length}`);

const emptyProfile = filterListingsByProfile([listing("Garson")], {
  ...frontend,
  targetRole: "",
  titles: [],
  skills: [],
  keywords: [],
  industries: [],
  experienceAreas: []
} as CandidateProfile);
check("Profil boşsa eleme yapılmaz", emptyProfile.kept.length === 1);


console.log("\n6) Aşırı geçirgenliğin kapatılması — canlı ölçümde çıkan durum");
check(
  "Metinde tek tesadüfi kelime yetmez",
  !isListingRelatedToProfile(listing("Saha Satış Temsilcisi", "Şirket web sitesi üzerinden sipariş alınır"), feTerms),
  '"web" tek başına geçersiz'
);
check(
  "Metinde iki farklı kelime yeter",
  isListingRelatedToProfile(listing("Ürün Ekibi", "React ve JavaScript deneyimi beklenir"), feTerms)
);
check("Başlıkta geçen tek kelime yeter", isListingRelatedToProfile(listing("React Geliştirici"), feTerms));
check(
  "Şirket adı da başlık sinyali sayılır",
  isListingRelatedToProfile({ ...listing("Yazılım Ekibi Üyesi"), company: "React Teknoloji A.Ş." } as CrawledJobListing, feTerms)
);

console.log("\n7) Engel/hata sayfaları ilan sayılmaz");
check("Cloudflare engeli yakalanır", looksLikeBlockedPage("Sorry, you have been blocked"), "canlı ölçümde Yenibiriş");
check("'Just a moment' yakalanır", looksLikeBlockedPage("Just a moment..."));
check("Erişim engeli yakalanır", looksLikeBlockedPage("Access Denied"));
check("Türkçe hata sayfası yakalanır", looksLikeBlockedPage("Sayfa bulunamadı"));
check("Gerçek ilan engel sayılmaz", !looksLikeBlockedPage("Frontend Developer", "React ile arayüz geliştirme"));

const withBlocked = filterListingsByProfile(
  [listing("Sorry, you have been blocked"), listing("Frontend Developer"), listing("Garson")],
  frontend
);
check("Engel sayfası sonuçlara girmez", withBlocked.kept.every((l) => !l.title.includes("blocked")), `kept=${withBlocked.kept.length}`);

const allBlocked = filterListingsByProfile([listing("Sorry, you have been blocked"), listing("Just a moment...")], frontend);
check("Engel sayfaları hiçbir koşulda geri gelmez", allBlocked.kept.length === 0);

console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
if (failed > 0) process.exitCode = 1;
