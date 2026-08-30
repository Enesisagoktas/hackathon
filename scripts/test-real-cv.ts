import "../lib/load-env";

import { readFile } from "fs/promises";
import path from "path";

/**
 * Gerçek bir CV dosyasını TAM akıştan geçirir ve ayrıntılı kalite raporu basar:
 * analiz → pozisyon önerisi → seçim → arama → sonuçlar → başvuru paketleri.
 *
 * Sentetik senaryo paketinden (test-scenarios) farkı: meslek kalıbı varsaymaz,
 * çıktıyı insan gözüyle değerlendirilecek biçimde döker (ilk 10 ilan tek tek,
 * elenenlerin gerekçeleri, kaynak notu).
 *
 * Kullanım:
 *   npx tsx scripts/test-real-cv.ts "C:\yol\cv.pdf"            (ilk 2 öneri seçilir)
 *   npx tsx scripts/test-real-cv.ts "C:\yol\cv.pdf" 3          (ilk 3 öneri)
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const POLL_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 480000);

let cookie = "";

async function call(pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) }
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    cookie = setCookie.split(";")[0];
  }
  return response;
}

type ResultRow = {
  title: string;
  company?: string;
  location?: string;
  url: string;
  matchScore: number;
  freshness?: string;
  platform?: string;
  foundInSources?: string[];
  eligibility?: {
    eligible: boolean;
    band?: string;
    bandLabel?: string;
    blockers?: { code: string; label: string; detail: string }[];
  };
};

async function main() {
  const cvPath = process.argv[2];
  const positionCount = Number(process.argv[3]) || 2;

  if (!cvPath) {
    console.error('Kullanım: npx tsx scripts/test-real-cv.ts "C:\\yol\\cv.pdf" [pozisyon sayısı]');
    process.exitCode = 1;
    return;
  }

  const fileName = path.basename(cvPath);
  const startedAt = Date.now();

  console.log(`\n═══ Gerçek CV testi: ${fileName} ═══\n`);

  // 1. Geçici kullanıcı
  const register = await call("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: `Gerçek CV Testi (${fileName.slice(0, 30)})`,
      email: `gercek-cv-${Date.now()}@cvmatch.local`,
      password: "gercek-cv-parola-123",
      kvkkAccepted: true,
      explicitConsentAccepted: true
    })
  });

  if (!register.ok) {
    throw new Error(`Kayıt başarısız: HTTP ${register.status}`);
  }

  // 2. CV yükleme (dosya olduğu gibi, Türkiye geneli, çalışma şekli farketmez)
  const buffer = await readFile(path.resolve(cvPath));
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), fileName);
  form.append("locationMode", "all-turkey");
  form.append("cities", "[]");
  form.append("workMode", "any");

  const upload = await call("/api/upload-cv", { method: "POST", body: form });
  const uploadBody = (await upload.json()) as Record<string, any>;

  if (!upload.ok || !uploadBody.searchId) {
    throw new Error(`Yükleme başarısız: ${uploadBody.message ?? upload.status}`);
  }

  const searchId = uploadBody.searchId as number;
  console.log(`CV yüklendi (arama #${searchId}). Analiz bekleniyor…`);

  const poll = async (targets: string[]) => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let lastDetail = "";

    while (Date.now() < deadline) {
      const response = await call(`/api/search-jobs/${searchId}`);
      const body = (await response.json()) as Record<string, any>;

      const running = (body.progressStages?.stages ?? []).find((s: any) => s.status === "running");
      const detail = running ? `${running.label}${running.detail ? ` — ${running.detail}` : ""}` : "";
      if (detail && detail !== lastDetail) {
        console.log(`  … ${detail}`);
        lastDetail = detail;
      }

      if (targets.includes(body.status) || body.status === "failed") {
        return body;
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    return null;
  };

  // 3. Analiz + öneriler
  const stage1 = await poll(["awaiting_selection"]);
  if (stage1?.status !== "awaiting_selection") {
    throw new Error(`Analiz tamamlanmadı: ${stage1?.status ?? "zaman aşımı"} ${stage1?.errorMessage ?? ""}`);
  }

  const suggested: string[] = stage1.suggestedPositions ?? [];
  const evalScore = stage1.evaluation?.score;

  console.log(`\n── Analiz (${Math.round((Date.now() - startedAt) / 1000)}sn) ──`);
  console.log(`CV puanı: ${evalScore ?? "—"}`);
  console.log(`Önerilen pozisyonlar: ${suggested.join(" | ") || "(yok)"}`);

  const chosen = suggested.slice(0, positionCount);
  console.log(`Seçilen: ${chosen.join(" | ")}\n`);

  // 4. Arama
  const searchStartedAt = Date.now();
  await call(`/api/search-jobs/${searchId}/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ positions: chosen, seniority: "any", note: "" })
  });

  const done = await poll(["completed"]);
  if (done?.status !== "completed") {
    throw new Error(`Arama tamamlanmadı: ${done?.status ?? "zaman aşımı"} ${done?.errorMessage ?? ""}`);
  }

  const results = (done.results ?? []) as ResultRow[];
  const eligible = results.filter((row) => row.eligibility?.eligible !== false);
  const rejected = results.filter((row) => row.eligibility?.eligible === false);

  console.log(`\n── Arama sonucu (${Math.round((Date.now() - searchStartedAt) / 1000)}sn) ──`);
  console.log(`Toplam: ${results.length} ilan | uygun: ${eligible.length} | gerekçeli elenen: ${rejected.length}`);
  console.log(`Kaynak notu: ${done.summary?.sourceNote ?? "—"}\n`);

  console.log("── İlk 10 uygun ilan ──");
  eligible.slice(0, 10).forEach((row, index) => {
    const sources = row.foundInSources?.length ? ` [${row.foundInSources.length} kaynak]` : "";
    const fresh = row.freshness === "new" ? " • Yeni" : row.freshness === "recent" ? " • Güncel" : "";
    console.log(
      `  ${String(index + 1).padStart(2)}. %${row.matchScore} ${row.eligibility?.bandLabel ?? ""}${fresh}${sources}\n` +
        `      ${row.title}${row.company ? ` — ${row.company}` : ""}${row.location ? ` (${row.location})` : ""}`
    );
  });

  if (rejected.length) {
    const reasons = new Map<string, number>();
    for (const row of rejected) {
      for (const blocker of row.eligibility?.blockers ?? []) {
        reasons.set(blocker.label, (reasons.get(blocker.label) ?? 0) + 1);
      }
    }
    console.log("\n── Elenenlerin gerekçeleri ──");
    Array.from(reasons.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([label, count]) => console.log(`  • ${label}: ${count} ilan`));
  }

  if (done.applySummary) {
    const s = done.applySummary;
    console.log(
      `\n── Başvuru paketleri ──\n  hazırlanan: ${s.prepared ?? 0} | otomatik gönderilen: ${s.autoSent ?? 0} | onay bekleyen: ${s.needsReview ?? 0} | elle başvuru: ${s.manualRequired ?? 0} | hata: ${s.failed ?? 0}`
    );
  }

  console.log(`\n═══ Toplam süre: ${Math.round((Date.now() - startedAt) / 1000)}sn ═══\n`);
}

main().catch((error) => {
  console.error("\nGerçek CV testi çöktü:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
