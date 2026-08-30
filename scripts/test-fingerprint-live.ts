import "../lib/load-env";

import { readFile } from "fs/promises";
import path from "path";

/**
 * Feature #8 canlı doğrulaması: AYNI kullanıcı + AYNI CV + AYNI kriterlerle
 * ikinci arama, boru hattını koşturmadan önbellekten dönmeli.
 *
 * Gereksinim: dev sunucu + worker ayakta (npm run dev). İki Gemini analiz
 * çağrısı yapar (2. tur profil/değerlendirme cache'lenmez), arama/skorlama
 * aşamasını atlar. test:units'e DAHİL DEĞİLDİR.
 *
 * Kullanım: npm run test:fingerprint:live
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const POLL_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 480000);
const CV_PATH = "samples/ornek-cv-frontend.pdf";

let cookie = "";
let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

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

async function runSearch(buffer: Buffer, positions?: string[]) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), "cv.pdf");
  form.append("locationMode", "all-turkey");
  form.append("cities", "[]");
  form.append("workMode", "any");

  const upload = await call("/api/upload-cv", { method: "POST", body: form });
  const uploadBody = (await upload.json()) as { searchId?: number };
  const searchId = uploadBody.searchId;

  if (!searchId) {
    throw new Error("Yükleme başarısız.");
  }

  const poll = async (targets: string[]) => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const response = await call(`/api/search-jobs/${searchId}`);
      const body = (await response.json()) as Record<string, any>;
      if (targets.includes(body.status) || body.status === "failed") {
        return body;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return null;
  };

  const stage1 = await poll(["awaiting_selection"]);
  if (stage1?.status !== "awaiting_selection") {
    throw new Error(`Analiz tamamlanmadı: ${stage1?.status} ${stage1?.errorMessage ?? ""}`);
  }

  const chosen = positions ?? (stage1.suggestedPositions ?? []).slice(0, 2);
  const searchStartedAt = Date.now();

  await call(`/api/search-jobs/${searchId}/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ positions: chosen, seniority: "any", note: "" })
  });

  const done = await poll(["completed"]);
  if (done?.status !== "completed") {
    throw new Error(`Arama tamamlanmadı: ${done?.status} ${done?.errorMessage ?? ""}`);
  }

  return {
    searchId,
    positions: chosen as string[],
    // Seçimden tamamlanmaya geçen süre; analiz süresi dahil değildir ama
    // 2. turda analiz cache'ten okunmaz — bu ölçüm yalnız arama aşamasını yansıtır.
    searchSeconds: Math.round((Date.now() - searchStartedAt) / 1000),
    resultCount: (done.results ?? []).length,
    sourceNote: String(done.summary?.sourceNote ?? "")
  };
}

async function main() {
  console.log(`\n═══ Parmak izi önbelleği canlı testi (${BASE}) ═══\n`);

  const register = await call("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Parmak İzi Testi",
      email: `fp-live-${Date.now()}@cvmatch.local`,
      password: "fp-live-parola-123",
      kvkkAccepted: true,
      explicitConsentAccepted: true
    })
  });

  if (!register.ok) {
    throw new Error("Kayıt başarısız.");
  }

  const buffer = await readFile(path.resolve(CV_PATH));

  console.log("1) İlk arama (gerçek tarama bekleniyor)...");
  const first = await runSearch(buffer);
  check("İlk arama sonuç üretti", first.resultCount > 0, `${first.resultCount} ilan, arama ${first.searchSeconds}sn`);
  check("İlk arama önbellekten GELMEDİ", !first.sourceNote.includes("önbellekten"), first.sourceNote.slice(0, 80));

  console.log("\n2) Aynı CV + aynı pozisyonlarla ikinci arama (önbellek bekleniyor)...");
  const second = await runSearch(buffer, first.positions);
  check("İkinci arama sonuç üretti", second.resultCount > 0, `${second.resultCount} ilan, arama ${second.searchSeconds}sn`);
  check("Sonuç sayısı birebir aynı", second.resultCount === first.resultCount, `${first.resultCount} → ${second.resultCount}`);
  check(
    "sourceNote önbelleği ve tarama saatini söylüyor",
    second.sourceNote.includes("önbellekten") && second.sourceNote.includes("tarandı"),
    second.sourceNote.slice(-120)
  );
  check(
    "Arama aşaması belirgin hızlandı",
    second.searchSeconds < Math.max(15, first.searchSeconds / 4),
    `${first.searchSeconds}sn → ${second.searchSeconds}sn`
  );

  console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Canlı test çöktü:", error);
  process.exitCode = 1;
});
