import {
  dedupeListings,
  fingerprint,
  groupDuplicates,
  normalizeCompany,
  normalizeTitle,
  richestListing,
  textSimilarity
} from "../lib/jobs/dedupe";
import { dedupeLocationSegments } from "../lib/jobs/normalize";

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n═══ Tekrar eden ilanların birleştirilmesi ═══\n");

console.log("1) Şirket adı normalizasyonu (gerçek veritabanı adları)");
check(
  "Hukuki ekler atılır",
  normalizeCompany("MerIT Bilişim Sanayi ve Ticaret Limited Şirketi") === normalizeCompany("MerIT Bilişim"),
  normalizeCompany("MerIT Bilişim Sanayi ve Ticaret Limited Şirketi")
);
check(
  "A.Ş. eki atılır",
  normalizeCompany("Nexum A.Ş.") === normalizeCompany("Nexum"),
  normalizeCompany("Nexum A.Ş.")
);
check(
  "Zincirli ekler atılır",
  normalizeCompany("CMIT BİLİŞİM VE ARGE ANONİM ŞİRKETİ").startsWith("cmit"),
  normalizeCompany("CMIT BİLİŞİM VE ARGE ANONİM ŞİRKETİ")
);
check("Farklı şirketler karışmaz", normalizeCompany("Nexum A.Ş.") !== normalizeCompany("Merit A.Ş."));

console.log("\n2) Pozisyon adı normalizasyonu");
check(
  "KIDEM AYIRT EDİCİDİR — senior ve düz ilan birleşmez",
  normalizeTitle("Senior Backend Developer") !== normalizeTitle("Backend Developer"),
  "aynı şirketin senior ve junior ilanı farklı işlerdir"
);
check(
  "ÇALIŞMA TÜRÜ AYIRT EDİCİDİR — part time ve full time birleşmez",
  normalizeTitle("Part Time Satış Danışmanı") !== normalizeTitle("Satış Danışmanı Full Time"),
  "ölçümde ikisi tek ilana birleşiyordu"
);
check("Remote süslemesi atılır", normalizeTitle("Frontend Developer (Remote)") === normalizeTitle("Frontend Developer"));
check("Farklı pozisyonlar karışmaz", normalizeTitle("Backend Developer") !== normalizeTitle("Frontend Developer"));

console.log("\n3) Parmak izi (şirket + pozisyon + şehir)");
const fp1 = fingerprint({ title: "Backend Developer", company: "Nexum A.Ş.", location: "İstanbul(Avr.) (Şişli)" });
const fp2 = fingerprint({ title: "Backend Developer", company: "Nexum", location: "İstanbul Anadolu" });
check("Aynı iş aynı parmak izi (şirket eki ve şehir biçimi farklı olsa da)", fp1 === fp2, fp1);
check(
  "AYNI UNVAN FARKLI ŞEHİR birleşmez",
  fingerprint({ title: "Hemşire", company: "Medical Park", location: "Ankara" }) !==
    fingerprint({ title: "Hemşire", company: "Medical Park", location: "İzmir" }),
  "zincir firmalar aynı unvanı her şehirde ayrı yayınlar"
);
check("Eksik veri parmak izi üretmez", fingerprint({ title: "Developer" }) === "");

console.log("\n4) Metin benzerliği");
const a = "React ve TypeScript ile modern arayüzler geliştirecek takım arkadaşı arıyoruz. Redux deneyimi beklenir.";
check("Aynı metin tam benzer", textSimilarity(a, a) === 1);
check("Alakasız metin benzemez", textSimilarity(a, "Garson aranıyor, restoran deneyimi tercih edilir.") < 0.15);
check("Boş metin sıfır döner", textSimilarity("", a) === 0);

console.log("\n5) Gruplama");
const listings = [
  { url: "https://a.com/1", title: "Backend Developer", company: "Nexum A.Ş.", location: "İstanbul", description: "x".repeat(50) },
  { url: "https://b.com/9", title: "Backend Developer", company: "Nexum", location: "İstanbul", description: "y".repeat(50) },
  { url: "https://c.com/3", title: "Frontend Developer", company: "Nexum", location: "İstanbul", description: "z".repeat(50) }
];
const groups = groupDuplicates(listings);
check("Aynı iş tek grupta", groups.length === 2, `${groups.length} grup`);
check("Kopya sayısı doğru", groups[0].duplicates.length === 1);

console.log("\n6) Aynı URL kesin kopya sayılır");
const sameUrl = groupDuplicates([
  { url: "https://a.com/ilan/1", title: "Aşçı", company: "X" },
  { url: "https://a.com/ilan/1/", title: "Tamamen Farklı Başlık", company: "Y" }
]);
check("Normalize URL eşleşir", sameUrl.length === 1, `${sameUrl.length} grup`);

console.log("\n7) Açıklama benzerliğiyle yakalama (farklı platform, aynı ilan)");
const shared = "Şirketimizde React ve TypeScript kullanarak modern web arayüzleri geliştirecek, Redux ve Jest deneyimi olan, takım çalışmasına yatkın frontend geliştirici arıyoruz. Ankara ofisimizde hibrit çalışma imkanı sunulmaktadır. Başvurular değerlendirilecektir.";
const crossPlatform = groupDuplicates([
  { url: "https://kariyer.net/x", title: "Frontend Developer", company: "Acme Teknoloji A.Ş.", description: shared },
  { url: "https://secretcv.com/y", title: "Ön Yüz Geliştirici", company: "Acme Teknoloji", description: shared + " Ek bilgi." }
]);
check("Farklı başlık, aynı metin → tek grup", crossPlatform.length === 1, `${crossPlatform.length} grup`);

console.log("\n8) Farklı şirketlerin benzer metni birleşmez");
const differentCompanies = groupDuplicates([
  { url: "https://a.com/1", title: "Frontend Developer", company: "Acme", description: shared },
  { url: "https://b.com/2", title: "Frontend Developer", company: "Beta Yazılım", description: shared }
]);
check("Şirket farklıysa ayrı kalır", differentCompanies.length === 2, `${differentCompanies.length} grup`);

console.log("\n9) En zengin kayıt birincil seçilir");
const rich = richestListing([
  { url: "https://a.com/1", title: "Developer", description: "kısa" },
  { url: "https://b.com/2", title: "Developer", company: "Acme", location: "Ankara", description: "u".repeat(500) }
]);
check("Dolu kayıt tercih edilir", rich.url === "https://b.com/2");

const outcome = dedupeListings(listings);
check("Kopyalar çıkarılır", outcome.unique.length === 2 && outcome.removed === 1, `${outcome.removed} kopya`);

console.log("\n10) Sınır durumları");
check("Boş liste çökertmez", dedupeListings([]).unique.length === 0);
check("Tek kayıt korunur", dedupeListings([listings[0]]).unique.length === 1);
const noMeta = dedupeListings([
  { url: "https://a.com/1", title: "", company: "" },
  { url: "https://a.com/2", title: "", company: "" }
]);
check("Kimlik bilgisi yoksa birleştirilmez", noMeta.unique.length === 2, "yanlış birleştirme yapılmaz");

console.log("\n11) Kalite raporunun bulduğu gerçek hatalar (veritabanından)");

// D&R: 12 farklı şehirdeki mağaza ilanı aynı şablon açıklamayı kullanıyor.
const drTemplate =
  "D&R mağazalarımızda görev alacak, müşteri ilişkilerinde başarılı, perakende deneyimi olan, esnek çalışma saatlerine uyum sağlayabilecek satış temsilcisi arkadaşlar arıyoruz. Kariyer fırsatları ve sosyal haklar sunulmaktadır. Başvurular gizli tutulacaktır.";
const drListings = [
  { url: "https://secretcv.com/d-r/satis-temsilcisi-ankara-1", title: "Satış Temsilcisi - Ankara Nokta", company: "D&R", location: "Ankara", description: drTemplate },
  { url: "https://secretcv.com/d-r/satis-temsilcisi-izmir-2", title: "Satış Temsilcisi - İzmir Point Bornova", company: "D&R", location: "İzmir", description: drTemplate },
  { url: "https://secretcv.com/d-r/satis-temsilcisi-kocaeli-3", title: "Satış Temsilcisi - Kocaeli 41 Burda", company: "D&R", location: "Kocaeli", description: drTemplate }
];
const drOutcome = dedupeListings(drListings);
check(
  "Aynı şablon açıklama + FARKLI şehir birleşmez",
  drOutcome.unique.length === 3 && drOutcome.removed === 0,
  `${drOutcome.unique.length} ilan korundu (D&R senaryosu)`
);

// Aynı şirket, aynı şehir, part time / full time ayrımı.
const shiftListings = [
  { url: "https://secretcv.com/x/pt-1", title: "Part Time Satış Danışmanı", company: "Barrels and Oil", location: "İstanbul", description: drTemplate },
  { url: "https://secretcv.com/x/ft-2", title: "Satış Danışmanı - Full Time", company: "Barrels and Oil", location: "İstanbul", description: drTemplate.replace("satış temsilcisi", "satış danışmanı") }
];
const shiftOutcome = dedupeListings(shiftListings);
check(
  "Part time ve full time ilanları ayrı kalır (aynı şablon açıklamayla bile)",
  shiftOutcome.unique.length === 2 && shiftOutcome.removed === 0,
  `${shiftOutcome.unique.length} ilan korundu`
);

// Gerçek kopya hâlâ yakalanmalı: aynı şirket, aynı unvan, aynı şehir, iki platform.
const genuine = dedupeListings([
  { url: "https://kariyer.net/is-ilani/batigoz-hemsire-1", title: "Hemşire", company: "Batıgöz Sağlık Grubu", location: "İzmir", description: drTemplate },
  { url: "https://secretcv.com/batigoz/hemsire-2", title: "Hemşire", company: "Batıgöz Sağlık Grubu", location: "İzmir", description: "farklı kısa metin" }
]);
check("Gerçek platformlar-arası kopya hâlâ birleşir", genuine.removed === 1, "Batıgöz senaryosu");

// Konum metnindeki tekrarlı parçalar (Secretcv çoklu lokasyon ilanlarında
// gerçek CV testinde görüldü: "İstanbul Anadolu, İstanbul Avrupa" iki kez).
console.log("\n8) Konum metni tekrar temizliği");
check(
  "Tekrarlı parçalar atılır",
  dedupeLocationSegments("İstanbul Anadolu, İstanbul Avrupa, İstanbul Anadolu, İstanbul Avrupa, TR") ===
    "İstanbul Anadolu, İstanbul Avrupa, TR"
);
check("Tekrarsız konum aynen kalır", dedupeLocationSegments("Ankara, Çankaya") === "Ankara, Çankaya");
check(
  "Büyük/küçük harf farkı tekrar sayılır, ilk yazım korunur",
  dedupeLocationSegments("İzmir, İZMİR, Bornova") === "İzmir, Bornova"
);
check("Tek parçalı konum dokunulmaz", dedupeLocationSegments("İstanbul") === "İstanbul");

console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
if (failed > 0) process.exitCode = 1;
