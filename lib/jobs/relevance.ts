import { normalizeComparable } from "@/lib/jobs/normalize";
import type { CandidateProfile, CrawledJobListing } from "@/lib/jobs/types";

/**
 * Tarama sonuçlarını profille ilgisi olmayanlardan arındırır.
 *
 * NEDEN GEREKLİ: İlan siteleri, slug tabanlı arama hiçbir şey bulamadığında
 * hata vermez — sitenin genel ilan listesini döner. Crawler o sayfayı normal
 * bir arama sonucu sanıp içindeki her ilanı kaydeder. Ölçüm sonucu: veritabanına
 * `source_query = "Senior Frontend Developer"` etiketiyle 50 ilan yazılmıştı ve
 * hiçbirinin başlığında "developer" geçmiyordu; gelenler garson, çağrı merkezi
 * ve satış temsilcisi ilanlarıydı. Bu kirlilik yalnız o aramayı değil, ortak
 * cache'i kullanan bütün kullanıcıları etkiliyor.
 *
 * AMAÇ İSABETLİ SIRALAMA DEĞİL — onu AI skorlaması yapıyor — apaçık alakasız
 * olanı cache'e hiç sokmamak. Eşleşme kuralı `isListingRelatedToProfile`
 * içinde iki kademelidir; tek bir tesadüfi kelime yeterli sayılmaz.
 */

/** Tek başına ayırt edici olmayan, her ilanda geçebilen kelimeler. */
const GENERIC_TERMS = new Set([
  "developer",
  "uzman",
  "uzmani",
  "sorumlu",
  "sorumlusu",
  "eleman",
  "elemani",
  "personel",
  "personeli",
  "asistan",
  "asistani",
  "yardimci",
  "yardimcisi",
  "calisan",
  "is",
  "isi",
  "ve",
  "ile",
  "icin",
  "senior",
  "junior",
  "mid",
  "lead",
  "kidemli",
  "tecrubeli",
  "deneyimli",
  "stajyer",
  "intern",
  "tam",
  "yari",
  "zamanli",
  "part",
  "time",
  "full",
  "remote",
  "uzaktan",
  "hibrit",
  "ofis",
  "ofisten"
]);

const MIN_TERM_LENGTH = 3;

/** Profilden, ilanla karşılaştırılacak ayırt edici kelimeleri çıkarır. */
export function buildProfileTerms(profile: CandidateProfile): string[] {
  const sources = [
    profile.targetRole,
    ...(profile.titles ?? []),
    ...(profile.skills ?? []),
    ...(profile.keywords ?? []),
    ...(profile.industries ?? []),
    ...(profile.experienceAreas ?? []),
    ...(profile.queryVariations ?? [])
  ];

  const terms = new Set<string>();

  for (const source of sources) {
    const normalized = normalizeComparable(source ?? "");
    if (!normalized) {
      continue;
    }

    // Hem tam ifadeyi hem tek tek kelimeleri ekle: "react native" ifadesi de
    // "react" kelimesi de eşleşme sayılsın.
    if (normalized.length >= MIN_TERM_LENGTH && !GENERIC_TERMS.has(normalized)) {
      terms.add(normalized);
    }

    for (const word of normalized.split(" ")) {
      if (word.length >= MIN_TERM_LENGTH && !GENERIC_TERMS.has(word)) {
        terms.add(word);
      }
    }
  }

  return Array.from(terms);
}

/**
 * İlanın profille ilgili olup olmadığı.
 *
 * İki kademeli, çünkü tek bir kelimeyi metnin herhangi bir yerinde aramak
 * fazla geçirgen çıktı: canlı ölçümde "Saha Satış Temsilcisi" ilanı,
 * açıklamasında "web sitesi" geçtiği için frontend profiline uygun sayılıyordu.
 *
 *   1. Başlıkta ayrırt edici bir kelime varsa → tutulur (güçlü sinyal).
 *   2. Yoksa, ilan metninde EN AZ İKİ farklı ayrırt edici kelime aranır;
 *      tek bir tesadüfi kelime yetmez.
 */
const MIN_BODY_TERM_MATCHES = 2;

export function isListingRelatedToProfile(listing: CrawledJobListing, terms: string[]): boolean {
  if (!terms.length) {
    // Profilden hiç ayırt edici kelime çıkmadıysa eleme yapılamaz; AI karar verir.
    return true;
  }

  const title = normalizeComparable([listing.title, listing.company].filter(Boolean).join(" "));
  if (title && terms.some((term) => title.includes(term))) {
    return true;
  }

  const body = normalizeComparable(
    [listing.description, ...(listing.requirements ?? []), ...(listing.candidateCriteria ?? [])]
      .filter(Boolean)
      .join(" ")
  );

  if (!title && !body) {
    return true;
  }

  let matches = 0;
  for (const term of terms) {
    if (body.includes(term)) {
      matches += 1;
      if (matches >= MIN_BODY_TERM_MATCHES) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Sayfanın gerçek bir ilan yerine engelleme/hata sayfası olup olmadığı.
 *
 * Canlı ölçümde Yenibiriş'in Cloudflare engel sayfası parse edilip
 * başlığı "Sorry, you have been blocked" olan dört "ilan" üretilmişti.
 */
const BLOCK_PAGE_PATTERNS = [
  /you have been blocked/i,
  /access denied/i,
  /attention required/i,
  /just a moment/i,
  /checking your browser/i,
  /error 4\d\d/i,
  /sayfa bulunamadı/i,
  /erişim engellendi/i,
  /robot değilim/i,
  /captcha/i
];

export function looksLikeBlockedPage(title: string, description = ""): boolean {
  const haystack = `${title} ${description.slice(0, 300)}`;
  return BLOCK_PAGE_PATTERNS.some((pattern) => pattern.test(haystack));
}

export type RelevanceFilterOutcome = {
  kept: CrawledJobListing[];
  dropped: CrawledJobListing[];
};

/**
 * Taranan ilanları profille ilgisi olmayanlardan ayırır.
 *
 * Profilden hiç ayırt edici kelime çıkmazsa eleme zaten yapılmaz
 * (`isListingRelatedToProfile` her ilanı geçirir), bu yüzden ayrıca
 * "hepsi elenecekse hepsini tut" supabı YOKTUR: bu supap platform bazında
 * çalışınca ters teper — ölçümde Eleman.net yalnızca resepsiyon/güvenlik
 * ilanları döndüğü için "hiçbiri uymuyor" durumu oluşuyor ve dördü birden
 * frontend aramasına geri ekleniyordu. Bir platformun uygun ilanı yoksa
 * doğru sonuç sıfırdır.
 */
export function filterListingsByProfile(
  listings: CrawledJobListing[],
  profile: CandidateProfile
): RelevanceFilterOutcome {
  const terms = buildProfileTerms(profile);
  const kept: CrawledJobListing[] = [];
  const dropped: CrawledJobListing[] = [];

  // Engel/hata sayfaları hiçbir koşulda ilan sayılmaz — güvenlik supabı da
  // bunları geri getirmemeli.
  const real = listings.filter((listing) => !looksLikeBlockedPage(listing.title, listing.description));

  for (const listing of real) {
    if (isListingRelatedToProfile(listing, terms)) {
      kept.push(listing);
    } else {
      dropped.push(listing);
    }
  }

  return { kept, dropped };
}
