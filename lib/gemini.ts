export type GeminiOptions = {
  /** Per-request abort timeout. Defaults to GEMINI_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Max attempts (retries). Defaults to GEMINI_MAX_ATTEMPTS. */
  maxAttempts?: number;
};

export async function generateJsonWithGemini<T>(
  systemInstruction: string,
  prompt: string,
  options: GeminiOptions = {}
): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY eksik. Lütfen .env dosyasını kontrol edin.");
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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

  const data = await fetchGeminiJson(url, requestBody, timeoutMs, maxAttempts);
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

let geminiQueue: Promise<void> = Promise.resolve();
let lastGeminiRequestAt = 0;

async function fetchGeminiJson(
  url: string,
  requestBody: Record<string, unknown>,
  timeoutMs: number,
  maxAttempts: number
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
    await waitForGeminiSlot();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Gemini API Error:", response.status, errorText);

        if (isRetryableStatus(response.status) && attempt < maxAttempts) {
          await sleep(getRetryDelayMs(attempt));
          continue;
        }

        throw new Error(`Gemini API Hatası: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;

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
