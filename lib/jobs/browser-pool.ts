/**
 * Browser Pool — Puppeteer-based HTML fetcher for anti-bot bypass.
 *
 * Uses a single shared browser instance with multiple pages.
 * Falls back gracefully if Puppeteer is not installed.
 */

type BrowserLike = {
  connected: boolean;
  newPage: () => Promise<PageLike>;
  close: () => Promise<void>;
  on: (event: string, handler: () => void) => void;
};

type PageLike = {
  setUserAgent: (ua: string) => Promise<void>;
  setViewport: (vp: { width: number; height: number }) => Promise<void>;
  setExtraHTTPHeaders: (headers: Record<string, string>) => Promise<void>;
  goto: (url: string, opts?: { waitUntil: string | string[]; timeout: number }) => Promise<unknown>;
  content: () => Promise<string>;
  close: () => Promise<void>;
  waitForSelector: (selector: string, opts?: { timeout: number }) => Promise<unknown>;
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

let browser: BrowserLike | null = null;
let browserPromise: Promise<BrowserLike> | null = null;
let puppeteerAvailable: boolean | null = null;

async function ensureBrowser(): Promise<BrowserLike> {
  if (browser?.connected) return browser;

  if (browserPromise) return browserPromise;

  browserPromise = (async () => {
    try {
      // Dynamic import so the module works even when puppeteer is not installed
      const puppeteer = await import("puppeteer");
      const instance = await puppeteer.default.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-sync",
          "--no-first-run",
          "--no-zygote"
        ]
      });

      browser = instance as unknown as BrowserLike;
      puppeteerAvailable = true;

      browser.on("disconnected", () => {
        browser = null;
        browserPromise = null;
      });

      return browser;
    } catch (error) {
      browserPromise = null;
      puppeteerAvailable = false;
      throw error;
    }
  })();

  return browserPromise;
}

/**
 * Fetch HTML using a real browser (Puppeteer).
 * Returns rendered HTML including JS-generated content.
 * Throws if Puppeteer is not available.
 */
export async function fetchWithBrowser(url: string, timeoutMs = 15000): Promise<string> {
  const b = await ensureBrowser();
  const page = await b.newPage();

  try {
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7"
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });

    // Small wait for dynamic content to render
    await new Promise((resolve) => setTimeout(resolve, 1500));

    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Check if Puppeteer is available without launching a browser.
 */
export function isBrowserAvailable(): boolean {
  return puppeteerAvailable === true;
}

/**
 * Check if Puppeteer module exists. Caches the result.
 */
export async function checkBrowserAvailability(): Promise<boolean> {
  if (puppeteerAvailable !== null) return puppeteerAvailable;

  try {
    await import("puppeteer");
    puppeteerAvailable = true;
    return true;
  } catch {
    puppeteerAvailable = false;
    return false;
  }
}

/**
 * Close the shared browser instance.
 */
export async function closeBrowser(): Promise<void> {
  if (browser?.connected) {
    await browser.close().catch(() => {});
  }

  browser = null;
  browserPromise = null;
}
