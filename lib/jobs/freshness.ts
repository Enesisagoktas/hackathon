/**
 * İlan tazeliği ağırlığı (Feature #2).
 *
 * İKİ TASARIM KURALI:
 *  1. Tazelik KÜÇÜK bir etkendir (±3 puan) — uyumluluğu asla domine edemez.
 *     Mükemmel uyumlu 15 günlük ilan, zayıf uyumlu dünkü ilanın üstünde kalır.
 *  2. Düzeltme, gösterilen puana İŞLENİR; ayrı bir sıralama ekseni DEĞİLDİR.
 *     Kullanıcının gördüğü sayı ile sıralama her zaman aynı kalır (daha önce
 *     ikinci eksenli sıralama "rastgele" algısı yaratmıştı — tekrarlanmaz).
 *
 * Tümü deterministik tarih matematiğidir; AI'ya sorulmaz (§17).
 */

export type FreshnessLabel = "new" | "recent" | "old" | null;

export type FreshnessOutcome = {
  /** matchScore'a eklenecek düzeltme (puan). */
  adjust: number;
  /** Rozet etiketi; tarih bilinmiyorsa null (rozet gösterilmez). */
  label: FreshnessLabel;
  /** İlan yaşı (gün); tarih bilinmiyorsa null. */
  ageDays: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bantlar (şartname önerisi):
 *   0-3 gün   → +3 (güçlü tazelik bonusu) + "new" rozeti
 *   4-7 gün   → +1 (ılımlı bonus) + "recent" rozeti
 *   8-20 gün  → 0 (nötr)
 *   21+ gün   → −2 (küçük ceza) + "old" rozeti
 *
 * Tarih yoksa veya bozuksa: 0 düzeltme, rozet yok — bilinmeyen tarih ilanın
 * lehine de aleyhine de kullanılmaz (temkin ilkesi).
 */
export function computeFreshness(postedAt: string | undefined, now: Date = new Date()): FreshnessOutcome {
  if (!postedAt) {
    return { adjust: 0, label: null, ageDays: null };
  }

  const parsed = Date.parse(postedAt);

  if (Number.isNaN(parsed)) {
    return { adjust: 0, label: null, ageDays: null };
  }

  const ageMs = now.getTime() - parsed;

  // Gelecek tarihli ilan (saat dilimi kayması vb.): bugün yayınlanmış sayılır.
  const ageDays = Math.max(0, Math.floor(ageMs / DAY_MS));

  if (ageDays <= 3) {
    return { adjust: 3, label: "new", ageDays };
  }

  if (ageDays <= 7) {
    return { adjust: 1, label: "recent", ageDays };
  }

  if (ageDays <= 20) {
    return { adjust: 0, label: null, ageDays };
  }

  return { adjust: -2, label: "old", ageDays };
}

/** Rozet metinleri — arayüz katmanı için tek doğru kaynak. */
export const FRESHNESS_LABELS: Record<Exclude<FreshnessLabel, null>, string> = {
  new: "Yeni",
  recent: "Güncel",
  old: "Eski ilan"
};
