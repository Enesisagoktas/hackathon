import {
  incrementListingError,
  markListingActive,
  markListingExpired
} from "@/lib/jobs/repository";
import type { JobListingRecord } from "@/lib/jobs/types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 CVMatchVerifier/1.0";

const FETCH_TIMEOUT_MS = readPositive(process.env.VERIFY_FETCH_TIMEOUT_MS, 10000);
const EXPIRE_AFTER_DAYS = readPositive(process.env.VERIFY_EXPIRE_AFTER_DAYS, 30);

// Phrases that mean the posting is no longer open.
const CLOSED_MARKERS = [
  "ilan yayından kaldırıldı",
  "ilan yayinda degil",
  "başvuru sona erdi",
  "basvuru sona erdi",
  "başvurular sona ermiştir",
  "pozisyon kapandı",
  "pozisyon kapanmıştır",
  "ilan kapandı",
  "ilan kapanmıştır",
  "ilan süresi doldu",
  "bu ilan dolduruldu",
  "yayında olmayan ilan",
  "ilan bulunamadı",
  "sayfa bulunamadı",
  "this job is no longer",
  "position has been filled",
  "no longer accepting applications",
  "job posting expired"
];

export type VerifyDecision = "active" | "expired" | "error" | "skipped";

export type VerifyOutcome = {
  listingId: number;
  decision: VerifyDecision;
  reason: string;
};

/**
 * Verify a single cached listing and update its status in the DB.
 *  - 404/410 or a "closed" marker  → expired
 *  - reachable + parseable          → active (error_count reset)
 *  - timeout / 403 / 429 / 5xx      → error_count + 1 (escalates to 'stale' at 3)
 *  - last_seen_at older than N days → expired
 * A single timeout never expires a listing on its own.
 */
export async function verifyListing(record: JobListingRecord): Promise<VerifyOutcome> {
  if (isOlderThanDays(record.lastSeenAt, EXPIRE_AFTER_DAYS)) {
    await markListingExpired(record.id, `last_seen_at ${EXPIRE_AFTER_DAYS} günden eski`);
    return outcome(record.id, "expired", `${EXPIRE_AFTER_DAYS} günden uzun süredir görülmedi`);
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(record.externalUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ağ hatası";
    await incrementListingError(record.id, `verify timeout/ağ hatası: ${message}`);
    return outcome(record.id, "error", `erişilemedi (${message})`);
  }

  if (response.status === 404 || response.status === 410) {
    await markListingExpired(record.id, `HTTP ${response.status}`);
    return outcome(record.id, "expired", `HTTP ${response.status}`);
  }

  if (response.status === 403 || response.status === 429 || response.status >= 500) {
    await incrementListingError(record.id, `HTTP ${response.status}`);
    return outcome(record.id, "error", `geçici hata HTTP ${response.status}`);
  }

  let body = "";
  try {
    body = (await response.text()).toLocaleLowerCase("tr-TR");
  } catch {
    await incrementListingError(record.id, "gövde okunamadı");
    return outcome(record.id, "error", "yanıt gövdesi okunamadı");
  }

  if (CLOSED_MARKERS.some((marker) => body.includes(marker))) {
    await markListingExpired(record.id, "kapanma ifadesi bulundu");
    return outcome(record.id, "expired", "sayfada ilan kapandı ifadesi");
  }

  if (body.length < 500) {
    // Suspiciously empty page — treat as transient, not a definitive close.
    await incrementListingError(record.id, "boş/kısa sayfa");
    return outcome(record.id, "error", "boş veya çok kısa sayfa");
  }

  await markListingActive(record.id);
  return outcome(record.id, "active", "erişilebilir ve geçerli");
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.7"
      },
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isOlderThanDays(value: string | undefined, days: number): boolean {
  if (!value) {
    return false;
  }
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    return false;
  }
  return Date.now() - time > days * 24 * 60 * 60 * 1000;
}

function outcome(listingId: number, decision: VerifyDecision, reason: string): VerifyOutcome {
  return { listingId, decision, reason };
}

function readPositive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
