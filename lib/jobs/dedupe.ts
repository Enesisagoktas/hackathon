import { normalizeComparable, normalizeUrl } from "@/lib/jobs/normalize";

/**
 * §10 — Aynı ilanın birden çok kez listelenmesini engeller.
 *
 * Aynı iş ilanı farklı platformlarda yayınlanır; şirket adı da her platformda
 * aynı yazılmaz ("MerIT Bilişim Sanayi ve Ticaret Limited Şirketi" ↔
 * "MerIT Bilişim"). Kullanıcı aynı işi üç kez görmemeli ve aynı işe üç kez
 * başvuru paketi hazırlanmamalı.
 *
 * Eşleşme sırası (ucuzdan pahalıya):
 *   1. Normalize edilmiş URL aynı  → kesin aynı ilan
 *   2. Şirket + pozisyon parmak izi → aynı ilan sayılır
 *   3. Açıklama benzerliği yüksek   → aynı ilan sayılır
 */

/** Şirket adındaki hukuki ekler karşılaştırmayı bozar; atılır. */
const COMPANY_SUFFIXES = [
  "anonim sirketi",
  "limited sirketi",
  "ltd sti",
  "ltd s ti",
  "a s",
  "as",
  "ltd",
  "sti",
  "sanayi ve ticaret",
  "sanayi",
  "ticaret",
  "tic",
  "san",
  "holding",
  "grup",
  "group",
  "inc",
  "llc",
  "gmbh"
];

/**
 * Şirket olamayacak site arayüz metinleri.
 *
 * Crawler bunları artık kaydetmiyor ama veritabanında eski kayıtlar var;
 * karşılaştırma tarafı da tanımalı ki "İş İlanı Ver şirketi" diye 17 farklı
 * ilan aynı gruba düşmesin (ölçümde birebir yaşandı).
 */
const BOGUS_COMPANY_NAMES = new Set([
  "is ilani ver",
  "is ilanlari",
  "isveren girisi",
  "firma adi gizli",
  "firma girisi",
  "giris yap",
  "uye ol",
  "ucretsiz is ilani ver"
]);

export function normalizeCompany(value: string | undefined): string {
  // normalizeComparable noktayı korur (sürüm numaraları, "Next.js" gibi
  // beceriler için gerekli). Şirket adında ise nokta kısaltma ayracıdır:
  // "Nexum A.Ş." → "nexum a.s." olur ve "a s" eki eşleşmez. Bu yüzden
  // burada noktalar boşluğa çevrilir.
  let text = normalizeComparable(value ?? "")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || BOGUS_COMPANY_NAMES.has(text)) {
    return "";
  }

  // Ekler tekrar tekrar geçebilir ("... sanayi ve ticaret limited sirketi").
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of COMPANY_SUFFIXES) {
      if (text.endsWith(` ${suffix}`)) {
        text = text.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }

  return text.trim();
}

/**
 * Pozisyon adından YALNIZCA süsleme niteliğindeki ekleri ayıklar.
 *
 * Kıdem (senior/junior/stajyer) ve çalışma türü (part/full time) BİLİNÇLİ
 * OLARAK KORUNUR: aynı mağazanın "Part Time Satış Danışmanı" ve "Satış
 * Danışmanı - Full Time" ilanları FARKLI işlerdir. Ölçümde bu ekler
 * atıldığı için ikisi tek ilana birleşiyor ve gerçek bir ilan kullanıcıdan
 * gizleniyordu. Yanlış birleştirme, ayrı göstermekten daha zararlıdır.
 */
const TITLE_NOISE = /\b(remote|uzaktan|hibrit|m\/f\/d|m f d)\b/g;

export function normalizeTitle(value: string | undefined): string {
  return normalizeComparable(value ?? "")
    .replace(TITLE_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Konumun şehir çekirdeği: "İstanbul(Asya) (Ümraniye)" → "istanbul".
 *
 * Platformlar şehri farklı biçimlerde yazar; karşılaştırma yalnızca ilk
 * anlamlı kelime üzerinden yapılır.
 */
export function cityToken(location: string | undefined): string {
  const normalized = normalizeComparable(location ?? "");
  return normalized.split(" ")[0] ?? "";
}

/**
 * Başlıktaki çalışma türü işareti: part time / full time / staj.
 *
 * Açıklama-benzerliği yolu için gerekli: aynı mağazanın part time ve full
 * time ilanı çoğu zaman aynı şablon açıklamayı kullanır; başlıktaki tür
 * işareti çelişiyorsa bunlar FARKLI işlerdir ve birleştirilmemelidir.
 */
export function employmentMarker(title: string | undefined): "part" | "full" | "staj" | null {
  const text = normalizeComparable(title ?? "");

  if (/staj|intern/.test(text)) return "staj";
  if (/part\s*time|yari\s*zamanli/.test(text)) return "part";
  if (/full\s*time|tam\s*zamanli/.test(text)) return "full";
  return null;
}

/**
 * İki konum aynı işi gösteriyor olabilir mi?
 *
 * Biri boşsa karar verilemez ve uyumlu sayılır (platformlardan biri konum
 * yazmamış olabilir). İkisi de doluysa şehir çekirdekleri eşleşmelidir:
 * aynı zincirin Ankara ve İzmir ilanları FARKLI işlerdir.
 */
export function locationsCompatible(left: string | undefined, right: string | undefined): boolean {
  const a = cityToken(left);
  const b = cityToken(right);

  if (!a || !b) {
    return true;
  }

  return a === b;
}

/**
 * İlanın kimlik parmak izi: şirket + pozisyon + şehir.
 *
 * Şehir parmak izine dahildir; çünkü zincir firmalar aynı unvanlı ilanı her
 * şehir için ayrı yayınlar (ölçüm: Medical Park'ın iki farklı "Hemşire"
 * ilanı birleşiyordu). Konumu yazılmamış ilan boş şehirle ayrı kalır —
 * emin olunamayan durumda birleştirmemek tercih edilir.
 */
export function fingerprint(listing: { title?: string; company?: string; location?: string }): string {
  const company = normalizeCompany(listing.company);
  const title = normalizeTitle(listing.title);

  if (!company || !title) {
    return "";
  }

  return `${company}|${title}|${cityToken(listing.location)}`;
}

/**
 * İki metnin kelime kümesi örtüşmesi (Jaccard).
 *
 * Tam eşitlik aranmaz: aynı ilan farklı platformlarda kırpılmış/biçimlenmiş
 * olabilir. Kısa metinlerde rastlantısal örtüşme yüksek çıkacağı için
 * çağıran taraf uzunluk eşiği uygular.
 */
export function textSimilarity(left: string, right: string): number {
  const tokenize = (value: string) =>
    new Set(
      normalizeComparable(value)
        .split(" ")
        .filter((word) => word.length >= 4)
    );

  const a = tokenize(left);
  const b = tokenize(right);

  if (!a.size || !b.size) {
    return 0;
  }

  let intersection = 0;
  a.forEach((word) => {
    if (b.has(word)) {
      intersection += 1;
    }
  });

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const DESCRIPTION_SIMILARITY_THRESHOLD = 0.72;
const MIN_DESCRIPTION_LENGTH = 200;

export type DedupableListing = {
  url: string;
  title?: string;
  company?: string;
  location?: string;
  description?: string;
};

export type DuplicateGroup<T extends DedupableListing> = {
  /** Kullanıcıya gösterilecek kayıt. */
  primary: T;
  /** Aynı ilanın diğer platformlardaki kopyaları. */
  duplicates: T[];
};

/**
 * Aynı ilanı temsil eden kayıtları gruplar.
 *
 * `pickPrimary` verilmezse ilk görülen kayıt birincil kabul edilir; çağıran
 * taraf "en zengin veriye sahip olanı seç" gibi bir kural verebilir.
 */
export function groupDuplicates<T extends DedupableListing>(
  listings: T[],
  pickPrimary?: (candidates: T[]) => T
): DuplicateGroup<T>[] {
  const groups: DuplicateGroup<T>[] = [];
  const byUrl = new Map<string, number>();
  const byFingerprint = new Map<string, number>();

  for (const listing of listings) {
    const url = normalizeUrl(listing.url);
    const print = fingerprint(listing);

    let index = url ? byUrl.get(url) : undefined;

    if (index === undefined && print) {
      index = byFingerprint.get(print);
    }

    // Parmak izi tutmadıysa açıklama benzerliğine bakılır. Bu adım pahalı
    // olduğu için yalnızca aynı şirketteki gruplarla karşılaştırılır.
    if (index === undefined && listing.description && listing.description.length >= MIN_DESCRIPTION_LENGTH) {
      const company = normalizeCompany(listing.company);

      for (let i = 0; i < groups.length; i += 1) {
        const candidate = groups[i].primary;

        // Açıklama benzerliği yalnızca GÜVENİLİR bir şirket eşleşmesi
        // üzerine kurulabilir. Şirket adı boş ya da sahte ise (site menü
        // yazısı) bu yol tamamen kapatılır: platform şablon metinleri
        // birbirine benzer ve farklı işler yanlışlıkla birleşir.
        if (!company || normalizeCompany(candidate.company) !== company) {
          continue;
        }

        // Aynı şablon açıklama, farklı şehir = farklı iş. Ölçüm: D&R'nin 12
        // farklı şehirdeki mağaza ilanı aynı açıklamayı kullandığı için tek
        // ilana birleşiyordu.
        if (!locationsCompatible(listing.location, candidate.location)) {
          continue;
        }

        // Başlıklardaki çalışma türü çelişiyorsa (part ↔ full ↔ staj) aynı
        // açıklama bile olsa farklı işlerdir.
        const leftMarker = employmentMarker(listing.title);
        const rightMarker = employmentMarker(candidate.title);

        if (leftMarker && rightMarker && leftMarker !== rightMarker) {
          continue;
        }

        if (
          candidate.description &&
          candidate.description.length >= MIN_DESCRIPTION_LENGTH &&
          textSimilarity(listing.description, candidate.description) >= DESCRIPTION_SIMILARITY_THRESHOLD
        ) {
          index = i;
          break;
        }
      }
    }

    if (index === undefined) {
      groups.push({ primary: listing, duplicates: [] });
      const newIndex = groups.length - 1;

      if (url) {
        byUrl.set(url, newIndex);
      }
      if (print) {
        byFingerprint.set(print, newIndex);
      }
      continue;
    }

    groups[index].duplicates.push(listing);

    if (url && !byUrl.has(url)) {
      byUrl.set(url, index);
    }
    if (print && !byFingerprint.has(print)) {
      byFingerprint.set(print, index);
    }
  }

  if (pickPrimary) {
    for (const group of groups) {
      if (!group.duplicates.length) {
        continue;
      }

      const all = [group.primary, ...group.duplicates];
      const chosen = pickPrimary(all);
      group.primary = chosen;
      group.duplicates = all.filter((item) => item !== chosen);
    }
  }

  return groups;
}

/** En zengin kaydı birincil seçer: açıklama uzunluğu ve dolu alan sayısı. */
export function richestListing<T extends DedupableListing>(candidates: T[]): T {
  return candidates.reduce((best, current) => {
    const score = (item: T) =>
      (item.description?.length ?? 0) / 100 +
      (item.company ? 2 : 0) +
      (item.location ? 1 : 0) +
      (item.title ? 1 : 0);

    return score(current) > score(best) ? current : best;
  }, candidates[0]);
}

export type DedupeOutcome<T extends DedupableListing> = {
  unique: T[];
  /** Kaç kayıt kopya olduğu için çıkarıldı. */
  removed: number;
  /** §11 — Her benzersiz ilanın görüldüğü grup; kaynak sayısı buradan okunur. */
  groups: DuplicateGroup<T>[];
};

/** Kopyaları çıkarır; her gruptan en zengin kayıt kalır. */
export function dedupeListings<T extends DedupableListing>(listings: T[]): DedupeOutcome<T> {
  const groups = groupDuplicates(listings, richestListing);
  const unique = groups.map((group) => group.primary);

  return { unique, removed: listings.length - unique.length, groups };
}
