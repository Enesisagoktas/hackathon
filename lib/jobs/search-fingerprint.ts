import { createHash } from "crypto";

/**
 * Feature #8 — Arama parmak izi önbelleği.
 *
 * Aynı kullanıcı, aynı CV ve aynı arama kriterleri kısa aralıkla tekrar
 * gelirse tüm tarama + AI skorlama boru hattını yeniden çalıştırmak hem yavaş
 * hem de Gemini kotasını boşa harcar. Parmak izi bu "aynılığı" deterministik
 * olarak tanımlar.
 *
 * GÜVENLİK SINIRLARI (bilerek parmak izine dahil):
 *   - userId + cvId: sonuçlardaki uygunluk kararları ve skorlar CV'ye göre
 *     kişiselleştirilmiştir; başka kullanıcıya veya güncellenmiş CV'ye asla
 *     taşınamaz. CV değişince cvId değişir → önbellek kendiliğinden düşer.
 *   - searchNote: not, sorgu üretimini ve önceliklendirmeyi etkiler; farklı
 *     not = farklı arama.
 */

export type SearchFingerprintInput = {
  userId?: number | null;
  cvId?: number | null;
  selectedPositions: string[];
  seniorityFilter?: string | null;
  locationMode: string;
  cities: string[];
  workMode: string;
  searchNote?: string | null;
};

/** Aynı parmak izli tamamlanmış arama bu süre içindeyse yeniden kullanılır. */
export function searchCacheTtlHours(): number {
  const parsed = Number(process.env.SEARCH_CACHE_TTL_HOURS);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return 6;
}

/** Küçük harf + boşluk sadeleştirme; sıralama çağıran tarafta yapılır. */
function normalizeTerm(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function normalizeList(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeTerm).filter(Boolean))).sort();
}

export function computeSearchFingerprint(input: SearchFingerprintInput): string {
  const parts = [
    `u:${input.userId ?? "-"}`,
    `cv:${input.cvId ?? "-"}`,
    `p:${normalizeList(input.selectedPositions).join(",")}`,
    `s:${normalizeTerm(input.seniorityFilter ?? "any") || "any"}`,
    `l:${normalizeTerm(input.locationMode)}`,
    `c:${normalizeList(input.cities).join(",")}`,
    `w:${normalizeTerm(input.workMode)}`,
    `n:${normalizeTerm(input.searchNote ?? "")}`
  ];

  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}
