import path from "path";
import { readFile } from "fs/promises";

import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

/**
 * Çalışan dev sunucusuna karşı gerçek HTTP akışını uygular:
 *   npm run dev            (ayrı terminalde)
 *   npm run test:e2e
 *
 * Kayıt → CV yükleme → worker → başvuru paketleri → dosya indirme.
 * Otomatik gönderim varsayılan olarak kapalı olduğu için E-POSTA GÖNDERİLMEZ.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const CV_PATH = process.env.E2E_CV_PATH ?? "samples/ornek-cv-frontend.pdf";
const EMAIL = `e2e-${Date.now()}@cvmatch.local`;
const PASSWORD = "e2e-test-parola-123";
const POLL_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 240000);

let passed = 0;
let failed = 0;
let cookie = "";

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Oturum çerezini taşıyan fetch sarmalayıcısı. */
async function call(pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
    redirect: "manual"
  });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    cookie = setCookie.split(";")[0];
  }

  return response;
}

async function callJson(pathname: string, init: RequestInit = {}) {
  const response = await call(pathname, init);
  const body = await response.json().catch(() => ({}));
  return { response, body: body as Record<string, any> };
}

async function run() {
  console.log(`\n═══ Uçtan uca HTTP testi (${BASE_URL}) ═══\n`);

  // ── 1. Sunucu ayakta mı ────────────────────────────────────────────────
  const health = await fetch(BASE_URL).catch(() => null);
  if (!health?.ok) {
    console.error(`Sunucuya ulaşılamadı: ${BASE_URL}\nÖnce "npm run dev" çalıştırın.`);
    process.exitCode = 1;
    return;
  }
  console.log("1) Sunucu ayakta\n");

  // ── 2. Oturum olmadan korumalı uçlar reddediyor mu ─────────────────────
  console.log("2) Yetkilendirme");
  const anon = await call("/api/applications");
  check("Oturumsuz /api/applications 401 veriyor", anon.status === 401, `HTTP ${anon.status}`);

  const anonUpload = await call("/api/upload-cv", { method: "POST", body: new FormData() });
  check("Oturumsuz yükleme reddediliyor", anonUpload.status >= 400, `HTTP ${anonUpload.status}`);

  // ── 3. Kayıt ───────────────────────────────────────────────────────────
  console.log("\n3) Kayıt ve oturum");
  const register = await callJson("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "E2E Test Kullanıcısı",
      email: EMAIL,
      password: PASSWORD,
      kvkkAccepted: true,
      explicitConsentAccepted: true
    })
  });

  check("Kayıt başarılı", register.response.ok, register.body.message ?? `#${register.body.user?.id}`);
  check("Oturum çerezi alındı", cookie.includes("cvmatch_session"));

  const me = await callJson("/api/auth/me");
  check("Oturum doğrulandı", me.body.user?.email === EMAIL, me.body.user?.email);

  // Aynı e-posta + YANLIŞ şifre hesabı ele geçiremez.
  const savedCookie = cookie;
  cookie = "";
  const hijack = await callJson("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Saldırgan",
      email: EMAIL,
      password: "baska-bir-parola-999",
      kvkkAccepted: true,
      explicitConsentAccepted: true
    })
  });
  check(
    "Var olan e-posta yanlış şifreyle ele geçirilemiyor",
    !hijack.response.ok,
    `HTTP ${hijack.response.status}: ${hijack.body.message}`
  );
  cookie = savedCookie;

  // ── 4. CV yükleme ──────────────────────────────────────────────────────
  console.log("\n4) CV yükleme");
  const cvBuffer = await readFile(path.resolve(CV_PATH));
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(cvBuffer)], { type: "application/pdf" }), path.basename(CV_PATH));
  form.append("locationMode", "all-turkey");
  form.append("cities", "[]");
  form.append("workMode", "any");

  const upload = await callJson("/api/upload-cv", { method: "POST", body: form });
  check("Yükleme kuyruğa alındı", upload.response.ok && Boolean(upload.body.searchId), `search #${upload.body.searchId}`);
  check("Ana CV kaydedildi", Boolean(upload.body.cvId), `cv #${upload.body.cvId}`);

  if (!upload.body.searchId) {
    console.error("Yükleme başarısız, test durduruluyor.");
    process.exitCode = 1;
    return;
  }

  // ── 5. Aşama 1: analiz ve pozisyon önerileri ───────────────────────────
  console.log("\n5) Aşama 1 — CV analizi (worker)");
  const searchId = upload.body.searchId;
  let status: Record<string, any> = {};

  const pollUntil = async (targets: string[], label: string) => {
    const startedAt = Date.now();
    let lastProgress = -1;

    while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      const poll = await callJson(`/api/search-jobs/${searchId}`);
      status = poll.body;

      if (status.progress !== lastProgress) {
        console.log(`  ... [${label}] durum=${status.status} ilerleme=%${status.progress}`);
        lastProgress = status.progress;
      }

      if (targets.includes(status.status) || status.status === "failed") {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  };

  await pollUntil(["awaiting_selection"], "analiz");

  check(
    "Analiz bitti ve pozisyon seçimi bekleniyor",
    status.status === "awaiting_selection",
    `${status.status} — ${status.errorMessage ?? "hata yok"}`
  );
  check(
    "AI en güçlü pozisyonları önerdi",
    (status.suggestedPositions?.length ?? 0) >= 1,
    (status.suggestedPositions ?? []).join(", ")
  );

  // ── 5b. Aşama 2: pozisyon seçimi + not + seviye ────────────────────────
  console.log("\n5b) Aşama 2 — pozisyon seçimi ve arama");

  const chosenPositions = (status.suggestedPositions ?? []).slice(0, 2);
  const selectRes = await callJson(`/api/search-jobs/${searchId}/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      positions: chosenPositions,
      seniority: "any",
      note: "React ve Next.js ağırlıklı pozisyonlara öncelik ver. Uzaktan çalışma tercihimdir."
    })
  });

  check("Pozisyon seçimi kabul edildi", selectRes.response.ok, selectRes.body.message);

  const positionsEcho = selectRes.body.positions ?? [];
  check("Seçilen pozisyonlar kaydedildi", positionsEcho.length === chosenPositions.length, positionsEcho.join(", "));

  await pollUntil(["completed"], "arama");

  check("Arama tamamlandı", status.status === "completed", `${status.status} — ${status.errorMessage ?? "hata yok"}`);
  check("AI profil üretildi", Boolean(status.aiProfile), `${status.aiProfile?.skills?.length ?? 0} beceri`);
  check("CV değerlendirmesi üretildi", Boolean(status.evaluation), `puan ${status.evaluation?.score}`);
  check("İlan sonuçları döndü", (status.results?.length ?? 0) > 0, `${status.results?.length ?? 0} ilan`);
  check("Başvuru özeti döndü", Boolean(status.applySummary), JSON.stringify(status.applySummary));

  // ── 6. Başvuru paketleri ───────────────────────────────────────────────
  console.log("\n6) Başvuru paketleri");
  const apps = await callJson("/api/applications");
  const applications: any[] = apps.body.applications ?? [];

  check("Başvuru listesi okundu", apps.response.ok, `${applications.length} başvuru`);
  check("En az bir başvuru paketi hazırlandı", applications.length > 0);

  const withCv = applications.filter((app) => app.tailoredCv);
  check("Uyarlanmış CV üretildi", withCv.length > 0, `${withCv.length} adet`);
  check("Hiçbiri gönderilmedi (otomatik kapalı)", applications.every((app) => app.status !== "sent"));

  const sample = withCv[0];
  if (sample) {
    console.log(`  Örnek: "${sample.listingTitle}" (${sample.matchScore} puan, ${sample.status}, ${sample.channel})`);
    console.log(`  Öne çıkarılan beceriler: ${(sample.tailoredCv.highlightedSkills ?? []).join(", ") || "(yok)"}`);
    console.log(`  Eksikler: ${(sample.gapReport ?? []).map((g: any) => g.requirement).slice(0, 5).join(", ") || "(yok)"}`);

    check("Uyarlanmış CV başlığı ilana hizalandı", Boolean(sample.tailoredCv.headline), sample.tailoredCv.headline);
    check("Ön yazı üretildi", (sample.coverLetter?.length ?? 0) > 80);
    check("PDF hazır", sample.hasPdf === true);
    check("DOCX hazır", sample.hasDocx === true);

    // Detay ucu
    const detail = await callJson(`/api/applications/${sample.id}`);
    check("Detay ucu çalışıyor", detail.response.ok);
    check("HTML önizleme üretildi", (detail.body.previewHtml?.length ?? 0) > 500);
    check("Denetim izi var", (detail.body.events?.length ?? 0) >= 2, `${detail.body.events?.length} olay`);

    // Dosya indirme
    const pdf = await call(`/api/applications/${sample.id}/file?format=pdf`);
    const pdfBytes = pdf.ok ? Buffer.from(await pdf.arrayBuffer()) : Buffer.alloc(0);
    check("PDF indirilebiliyor", pdf.ok && pdfBytes.byteLength > 1000, `${pdfBytes.byteLength} bayt`);
    check("İndirilen dosya gerçek PDF", pdfBytes.subarray(0, 4).toString() === "%PDF");

    const docx = await call(`/api/applications/${sample.id}/file?format=docx`);
    const docxBytes = docx.ok ? Buffer.from(await docx.arrayBuffer()) : Buffer.alloc(0);
    check("DOCX indirilebiliyor", docx.ok && docxBytes.byteLength > 1000, `${docxBytes.byteLength} bayt`);
    // DOCX bir ZIP arşividir; "PK" imzasıyla başlar.
    check("İndirilen dosya gerçek DOCX", docxBytes.subarray(0, 2).toString() === "PK");
  }

  // ── 7. Başka kullanıcının verisine erişim ──────────────────────────────
  console.log("\n7) Veri izolasyonu");
  const ownerCookie = cookie;
  cookie = "";

  const intruder = await callJson("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Baska Kullanici",
      email: `intruder-${Date.now()}@cvmatch.local`,
      password: "intruder-parola-123",
      kvkkAccepted: true,
      explicitConsentAccepted: true
    })
  });
  check("İkinci kullanıcı oluşturuldu", intruder.response.ok);

  const stolenSearch = await call(`/api/search-jobs/${searchId}`);
  check(
    "Başkasının CV analizi okunamıyor",
    stolenSearch.status === 404,
    `HTTP ${stolenSearch.status}`
  );

  if (sample) {
    const stolenApp = await call(`/api/applications/${sample.id}`);
    check("Başkasının başvurusu okunamıyor", stolenApp.status === 404, `HTTP ${stolenApp.status}`);

    const stolenFile = await call(`/api/applications/${sample.id}/file?format=pdf`);
    check("Başkasının CV dosyası indirilemiyor", stolenFile.status === 404, `HTTP ${stolenFile.status}`);
  }

  cookie = ownerCookie;

  // ── 8. Otomatik başvuru ayarı koruması ─────────────────────────────────
  console.log("\n8) Otomatik başvuru koruması");
  const badSettings = await callJson("/api/settings/apply", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoApplyEnabled: true })
  });
  check(
    "SMTP olmadan otomatik başvuru açılamıyor",
    !badSettings.response.ok,
    badSettings.body.message
  );

  // ── 9. CV silme (KVKK) ─────────────────────────────────────────────────
  console.log("\n9) KVKK — saklanan CV'yi silme");
  const del = await callJson("/api/cv", { method: "DELETE" });
  check("CV silindi", del.response.ok && del.body.deleted > 0, del.body.message);

  const afterDelete = await callJson("/api/cv");
  check("Silinen CV geri okunamıyor", afterDelete.body.cv === null);

  console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("\nTest çöktü:", error);
  process.exitCode = 1;
});
