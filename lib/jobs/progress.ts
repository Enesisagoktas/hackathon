/**
 * §22 — Arama ilerleme göstergesi.
 *
 * NEDEN: Arama, kaynakları boğmamak için kontrollü ve yavaş çalışır; bu da
 * kullanıcının dakikalarca bekleyeceği anlamına gelir. Tek bir yüzde çubuğu
 * "sistem gerçekten çalışıyor mu, yoksa dondu mu?" sorusunu cevaplamıyor.
 * Bu modül, hangi aşamada olunduğunu ve canlı sayaçları taşır.
 */

export type StageKey =
  | "plan"
  | "primary-search"
  | "alternative-search"
  | "boutique-search"
  | "verify"
  | "match"
  | "rank";

export type StageStatus = "pending" | "running" | "done" | "skipped" | "failed";

export type SearchStage = {
  key: StageKey;
  label: string;
  status: StageStatus;
  /** Aşamaya dair tek satırlık bilgi (ör. "3 kaynak tarandı"). */
  detail?: string;
};

export type SearchCounters = {
  /** Kaynaklardan toplanan ham ilan sayısı. */
  found: number;
  /** Detay sayfası açılıp doğrulanan ilan sayısı. */
  verified: number;
  /** Alakasız/kapalı/uygunsuz olduğu için elenen ilan sayısı. */
  eliminated: number;
  /** Kullanıcıya gösterilecek uygun ilan sayısı. */
  eligible: number;
};

export type SearchProgress = {
  stages: SearchStage[];
  counters: SearchCounters;
  /** Aşamaların hangi anda güncellendiği — arayüz "takıldı mı?" ayrımı yapar. */
  updatedAt: string;
};

const STAGE_LABELS: Record<StageKey, string> = {
  plan: "Arama planı hazırlanıyor",
  "primary-search": "Ana pozisyonlar taranıyor",
  "alternative-search": "Alternatif pozisyonlar taranıyor",
  "boutique-search": "Butik ve şirket kaynakları taranıyor",
  verify: "İlanlar doğrulanıyor",
  match: "Uygunluk analizi",
  rank: "Son sıralama"
};

export const STAGE_ORDER: StageKey[] = [
  "plan",
  "primary-search",
  "alternative-search",
  "boutique-search",
  "verify",
  "match",
  "rank"
];

export function createProgress(timestamp: string): SearchProgress {
  return {
    stages: STAGE_ORDER.map((key) => ({ key, label: STAGE_LABELS[key], status: "pending" as StageStatus })),
    counters: { found: 0, verified: 0, eliminated: 0, eligible: 0 },
    updatedAt: timestamp
  };
}

export type StageUpdate = {
  key: StageKey;
  status: StageStatus;
  detail?: string;
};

/**
 * Aşamayı günceller ve önceki aşamaları kapatır.
 *
 * Bir aşama "running" olduğunda öncekiler kesin bitmiştir; worker her adımda
 * geriye dönük kapatma yapmak zorunda kalmasın diye burada hallediliyor.
 */
export function applyStageUpdate(
  progress: SearchProgress,
  update: StageUpdate,
  timestamp: string,
  counters?: Partial<SearchCounters>
): SearchProgress {
  const index = STAGE_ORDER.indexOf(update.key);

  const stages = progress.stages.map((stage) => {
    const stageIndex = STAGE_ORDER.indexOf(stage.key);

    if (stage.key === update.key) {
      return { ...stage, status: update.status, detail: update.detail ?? stage.detail };
    }

    // Sonraki bir aşama başladıysa, hâlâ "running" görünen öncekiler bitmiştir.
    if (stageIndex < index && stage.status === "running") {
      return { ...stage, status: "done" as StageStatus };
    }

    return stage;
  });

  return {
    stages,
    counters: { ...progress.counters, ...counters },
    updatedAt: timestamp
  };
}

/** Aşama durumundan yüzde üretir; ayrı bir sayaç tutmaya gerek kalmaz. */
export function progressPercent(progress: SearchProgress): number {
  const weights: Record<StageKey, number> = {
    plan: 8,
    "primary-search": 22,
    "alternative-search": 15,
    "boutique-search": 12,
    verify: 18,
    match: 17,
    rank: 8
  };

  let total = 0;

  for (const stage of progress.stages) {
    const weight = weights[stage.key];

    if (stage.status === "done" || stage.status === "skipped") {
      total += weight;
    } else if (stage.status === "running") {
      total += weight / 2;
    }
  }

  return Math.min(99, Math.round(total));
}

/** Kayıttan okunan JSON'u güvenli biçimde ilerleme nesnesine çevirir. */
export function parseProgress(raw: unknown, fallbackTimestamp: string): SearchProgress | null {
  if (!raw) {
    return null;
  }

  const value = typeof raw === "string" ? safeParse(raw) : raw;

  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<SearchProgress>;

  if (!Array.isArray(candidate.stages)) {
    return null;
  }

  // Şema büyüdüğünde eski kayıtlar eksik aşama içerebilir; eksikler
  // "pending" olarak tamamlanır ki arayüz hep tam listeyi görsün.
  const byKey = new Map(candidate.stages.map((stage) => [stage.key, stage]));

  return {
    stages: STAGE_ORDER.map(
      (key) => byKey.get(key) ?? { key, label: STAGE_LABELS[key], status: "pending" as StageStatus }
    ),
    counters: {
      found: candidate.counters?.found ?? 0,
      verified: candidate.counters?.verified ?? 0,
      eliminated: candidate.counters?.eliminated ?? 0,
      eligible: candidate.counters?.eligible ?? 0
    },
    updatedAt: candidate.updatedAt ?? fallbackTimestamp
  };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
