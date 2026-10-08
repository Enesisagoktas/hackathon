export type GeminiOptions = {
  /** Per-request abort timeout. Defaults to GEMINI_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Max attempts (retries). Defaults to GEMINI_MAX_ATTEMPTS. */
  maxAttempts?: number;
};

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_FALLBACK_MODEL = "gemini-3.1-flash-lite";

/**
 * Ana modelin kotası dolduğunda (429) veya model kullanılamadığında (404/503)
 * yedek modele geçilir ve süreç ömrü boyunca oradan devam edilir ("yapışkan").
 *
 * Sebep: ücretsiz Gemini kotaları model başınadır ve bazı modellerde günde
 * 20 isteğe kadar düşebilir. Yapışkan olmasaydı her çağrı önce ana modele
 * gidip 429 yer, retry bekleme süreleriyle tüm akışı yavaşlatırdı. Sunucu
 * yeniden başlayınca sıfırlanır (günlük kota da zaten gece sıfırlanır).
 */
let activeModelOverride: string | null = null;

class GeminiApiError extends Error {
  status: number;

  constructor(status: number) {
    super(`Gemini API Hatası: ${status}`);
    this.name = "GeminiApiError";
    this.status = status;
  }
}

export async function generateJsonWithGemini<T>(
  systemInstruction: string,
  prompt: string,
  options: GeminiOptions = {}
): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY eksik. Lütfen .env dosyasını kontrol edin.");
  }

  const primaryModel = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;
  const model = activeModelOverride ?? primaryModel;
  const timeoutMs = options.timeoutMs ?? Number(process.env.GEMINI_TIMEOUT_MS ?? 20000);
  const maxAttempts = options.maxAttempts ?? Number(process.env.GEMINI_MAX_ATTEMPTS ?? 2);

  const requestBody = {
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.15,
      responseMimeType: "application/json"
    }
  };

  let data: GeminiResponse;

  try {
    data = await fetchGeminiJson(model, apiKey, requestBody, timeoutMs, maxAttempts);
  } catch (error) {
    // Kota/erişim hatasında yedek modele geç ve isteği bir kez daha dene.
    if (shouldSwitchModel(error) && fallbackModel && fallbackModel !== model) {
      console.warn(
        `[gemini] ${model} kullanılamıyor (${error instanceof Error ? error.message : error}); ` +
          `${fallbackModel} modeline geçiliyor.`
      );
      activeModelOverride = fallbackModel;
      data = await fetchGeminiJson(fallbackModel, apiKey, requestBody, timeoutMs, maxAttempts);
    } else {
      throw error;
    }
  }

  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (typeof content !== "string") {
    throw new Error("Gemini boş içerik döndürdü.");
  }

  try {
    return JSON.parse(content) as T;
  } catch (error) {
    console.error("Failed to parse Gemini response as JSON:", content);
    throw new Error("Gemini JSON çıktısı parse edilemedi.");
  }
}

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

/** Yedek modele geçmeyi gerektiren hatalar: kota (429), model yok (404), aşırı yük (503). */
function shouldSwitchModel(error: unknown): boolean {
  return error instanceof GeminiApiError && (error.status === 429 || error.status === 404 || error.status === 503);
}

let geminiQueue: Promise<void> = Promise.resolve();
let lastGeminiRequestAt = 0;

async function fetchGeminiJson(
  model: string,
  apiKey: string,
  requestBody: Record<string, unknown>,
  timeoutMs: number,
  maxAttempts: number
): Promise<GeminiResponse> {
  // Anahtar URL'de değil x-goog-api-key başlığında taşınır: URL'ler proxy ve
  // sunucu loglarına düştüğü için anahtarı sorgu parametresinde taşımak sızdırır.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
    await waitForGeminiSlot();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Gemini API Error (${model}):`, response.status, errorText.slice(0, 400));

        // 429'da attempt tekrarı israftır: aynı modelde kota hemen açılmaz.
        // Hata yukarı fırlatılır ve çağıran yedek modele geçer.
        if (response.status !== 429 && isRetryableStatus(response.status) && attempt < maxAttempts) {
          await sleep(getRetryDelayMs(attempt));
          continue;
        }

        throw new GeminiApiError(response.status);
      }

      return (await response.json()) as GeminiResponse;
    } catch (error) {
      lastError = error;

      if (error instanceof GeminiApiError) {
        throw error;
      }

      if (attempt < maxAttempts && isRetryableError(error)) {
        await sleep(getRetryDelayMs(attempt));
        continue;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini isteği tamamlanamadı.");
}

function waitForGeminiSlot() {
  const minIntervalMs = Number(process.env.GEMINI_MIN_INTERVAL_MS ?? 500);

  const next = geminiQueue.then(async () => {
    const elapsed = Date.now() - lastGeminiRequestAt;
    const waitMs = Math.max(0, minIntervalMs - elapsed);

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    lastGeminiRequestAt = Date.now();
  });

  geminiQueue = next.catch(() => undefined);
  return next;
}

function isRetryableStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isRetryableError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /fetch|network|timeout|aborted/i.test(error.message));
}

function getRetryDelayMs(attempt: number) {
  const maxDelayMs = Number(process.env.GEMINI_RETRY_MAX_DELAY_MS ?? 8000);
  return Math.min(maxDelayMs, 1500 * 2 ** (attempt - 1));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
