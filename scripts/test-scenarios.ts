import "../lib/load-env";

import { readFile } from "fs/promises";
import path from "path";

import { closeDbPool } from "../lib/db";
import { dedupeListings } from "../lib/jobs/dedupe";

/**
 * Gerçek kullanıcı senaryo paketi (Feature #7).
 *
 * 5 temsili meslek CV'siyle TAM akışı (yükleme → analiz → pozisyon seçimi →
 * arama → hard filter → AI skorlama → sonuçlar) canlı sunucu + worker
 * üzerinden koşar ve şartnamedeki metrikleri ölçer:
 *   süre, bulunan ilan, uygun ilan, ilk-10 kalitesi, kopya oranı,
 *   yanlış-pozitif oranı (uygun işaretli ama meslek-dışı görünen).
 *
 * Gemini kotası kullanır — units'e DAHİL DEĞİLDİR; elle/gece koşulur:
 *   npm run test:scenarios            (5 senaryo)
 *   npm run test:scenarios -- hemsire (tek senaryo)
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const POLL_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 480000);

type Scenario = {
  key: string;
  cvFile: string;
  /** İlk-10 kalite denetimi: başlık bu kalıba uyarsa meslek-içi sayılır. */
  professionPattern: RegExp;
};

const SCENARIOS: Scenario[] = [
  { key: "hemsire", cvFile: "ornek-cv-hemsire.pdf", professionPattern: /hem[şs]ire|sağlık|nurse|ebe|paramedik|anestezi/i },
  { key: "garson", cvFile: "ornek-cv-garson.pdf", professionPattern: /garson|servis|komi|kafe|restoran|bar|waiter|mutfak/i },
  { key: "muhasebe", cvFile: "ornek-cv-muhasebe.pdf", professionPattern: /muhasebe|mali|finans|fatura|bordro|accountant/i },
  { key: "ogretmen", cvFile: "ornek-cv-ogretmen.pdf", professionPattern: /öğretmen|egitim|eğitim|teacher|eğitmen|okul/i },
  { key: "yazilimci", cvFile: "ornek-cv-frontend.pdf", professionPattern: /developer|geliştirici|yazılım|engineer|frontend|arayüz|software/i }
];

type Metrics = {
  key: string;
  ok: boolean;
  seconds: number;
  suggested: number;
  results: number;
  eligible: number;
  top10InProfession: number;
  top10: number;
  duplicates: number;
  note: string;
};

async function runScenario(scenario: Scenario): Promise<Metrics> {
  const startedAt = Date.now();
  const email = `senaryo-${scenario.key}-${Date.now()}@cvmatch.local`;

  const metrics: Metrics = {
    key: scenario.key, ok: false, seconds: 0, suggested: 0, results: 0,
    eligible: 0, top10InProfession: 0, top10: 0, duplicates: 0, note: ""
  };

  try {
    const register = await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: `Senaryo ${scenario.key}`,
        email,
        password: "senaryo-parola-123",
        kvkkAccepted: true,
        explicitConsentAccepted: true
      })
    });
    const cookie = (register.headers.get("set-cookie") ?? "").split(";")[0];

    const call = (pathname: string, init: RequestInit = {}) =>
      fetch(`${BASE}${pathname}`, { ...init, headers: { ...(init.headers ?? {}), Cookie: cookie } });

    // 1. CV yükleme
    const buffer = await readFile(path.resolve("samples", scenario.cvFile));
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), scenario.cvFile);
    form.append("locationMode", "all-turkey");
    form.append("cities", "[]");
    form.append("workMode", "any");

    const upload = await call("/api/upload-cv", { method: "POST", body: form });
    const uploadBody = await upload.json();
    const searchId = uploadBody.searchId;

    if (!upload.ok || !searchId) {
      metrics.note = `yükleme başarısız: ${uploadBody.message ?? upload.status}`;
      return metrics;
    }

    // 2. Analiz + pozisyon önerisi bekle
    const poll = async (targets: string[]) => {
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const response = await call(`/api/search-jobs/${searchId}`);
        const body = await response.json();
        if (targets.includes(body.status) || body.status === "failed") {
          return body;
        }
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
      return null;
    };

    const stage1 = await poll(["awaiting_selection"]);
    if (stage1?.status !== "awaiting_selection") {
      metrics.note = `analiz tamamlanmadı: ${stage1?.status ?? "zaman aşımı"} ${stage1?.errorMessage ?? ""}`;
      return metrics;
    }

    metrics.suggested = (stage1.suggestedPositions ?? []).length;

    // 3. Pozisyon seç + arama
    await call(`/api/search-jobs/${searchId}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        positions: (stage1.suggestedPositions ?? []).slice(0, 2),
        seniority: "any",
        note: ""
      })
    });

    const done = await poll(["completed"]);
    if (done?.status !== "completed") {
      metrics.note = `arama tamamlanmadı: ${done?.status ?? "zaman aşımı"} ${done?.errorMessage ?? ""}`;
      return metrics;
    }

    // 4. Metrikler
    const results = (done.results ?? []) as Array<{
      title: string;
      url: string;
      company?: string;
      location?: string;
      description?: string;
      eligibility?: { eligible: boolean };
    }>;

    metrics.results = results.length;
    metrics.eligible = results.filter((item) => item.eligibility?.eligible !== false).length;

    const top10 = results.filter((item) => item.eligibility?.eligible !== false).slice(0, 10);
    metrics.top10 = top10.length;
    metrics.top10InProfession = top10.filter((item) => scenario.professionPattern.test(item.title)).length;

    metrics.duplicates = dedupeListings(
      results.map((item) => ({
        url: item.url,
        title: item.title,
        company: item.company,
        location: item.location,
        description: item.description
      }))
    ).removed;

    metrics.ok = metrics.eligible > 0;
    metrics.note = metrics.ok ? "" : "hiç uygun ilan çıkmadı";
    return metrics;
  } catch (error) {
    metrics.note = (error as Error).message.slice(0, 80);
    return metrics;
  } finally {
    metrics.seconds = Math.round((Date.now() - startedAt) / 1000);
  }
}

async function main() {
  const only = process.argv[2];
  const scenarios = only ? SCENARIOS.filter((scenario) => scenario.key === only) : SCENARIOS;

  if (!scenarios.length) {
    console.error(`Bilinmeyen senaryo: ${only}. Geçerli: ${SCENARIOS.map((s) => s.key).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n═══ Gerçek kullanıcı senaryoları (${scenarios.length} meslek) ═══\n`);

  const all: Metrics[] = [];

  for (const scenario of scenarios) {
    console.log(`▶ ${scenario.key} başlıyor…`);
    const metrics = await runScenario(scenario);
    all.push(metrics);
    console.log(
      `  ${metrics.ok ? "✓" : "✗"} ${metrics.key.padEnd(10)} ${metrics.seconds}sn | öneri=${metrics.suggested} | sonuç=${metrics.results} (uygun ${metrics.eligible}) | ilk10 meslek-içi=${metrics.top10InProfession}/${metrics.top10} | kopya=${metrics.duplicates}${metrics.note ? ` | ${metrics.note}` : ""}`
    );
  }

  const failedCount = all.filter((metrics) => !metrics.ok).length;
  const top10Total = all.reduce((sum, metrics) => sum + metrics.top10, 0);
  const top10Good = all.reduce((sum, metrics) => sum + metrics.top10InProfession, 0);

  console.log(
    `\n═══ Özet: ${all.length - failedCount}/${all.length} senaryo geçti | ilk-10 meslek isabeti ${top10Good}/${top10Total}${top10Total ? ` (%${Math.round((top10Good / top10Total) * 100)})` : ""} ═══\n`
  );

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Senaryo paketi çöktü:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDbPool().catch(() => undefined));
