import "../lib/load-env";
import path from "path";
import { stat } from "fs/promises";

import dotenv from "dotenv";
import mysql from "mysql2/promise";

import { closeDbPool, getDbPool } from "../lib/db";
import { decideApplicationChannel, findApplicationEmail } from "../lib/apply/channel";
import { prepareApplicationsForResults } from "../lib/apply/pipeline";
import { getApplication, listApplications, listApplicationEvents } from "../lib/apply/repository";
import { saveApplicationSettings } from "../lib/apply/settings";
import { extractStructuredCv } from "../lib/cv/structured";
import { getPrimaryCv, savePrimaryCv } from "../lib/cv/store";
import { hasEvidence, tailorCvForListing } from "../lib/cv/tailor";
import { registerUser, getUserByEmail } from "../lib/auth/users";
import { searchActiveListings } from "../lib/jobs/repository";
import type { JobSearchResult } from "../lib/jobs/types";
import type { CandidateProfile } from "../lib/jobs/types";
import type { TailoringListing } from "../lib/cv/types";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

/**
 * Başvuru hattının uçtan uca doğrulaması.
 *   npm run test:apply
 *
 * Gerçek MySQL kullanır, gerçek ilanlarla çalışır, gerçek PDF/DOCX üretir.
 * HİÇBİR E-POSTA GÖNDERMEZ: otomatik başvuru kapalı bırakılır.
 */

const TEST_EMAIL = "pipeline-test@cvmatch.local";

const SAMPLE_CV = `Ahmet Yılmaz
Frontend Developer
ahmet.yilmaz@example.com · +90 532 111 22 33 · İstanbul
linkedin.com/in/ahmetyilmaz

PROFESYONEL ÖZET
4 yıl deneyimli Frontend Developer. React, Next.js ve TypeScript ile ölçeklenebilir web uygulamaları geliştiriyorum.

İŞ DENEYİMİ
Senior Frontend Developer — Vega Teknoloji 2022 - 2025
- React, Next.js ve Redux ile e-ticaret arayüzünü yeniden geliştirdim; sayfa yüklenme süresini %35 azalttım.
- REST API entegrasyonları ve Jest ile birim testleri yazdım.
- 3 kişilik frontend ekibine mentorluk yaptım.

Frontend Developer — Kovan Studio 2020 - 2022
- TypeScript ve GraphQL ile SaaS ürün arayüzleri geliştirdim.
- Tailwind CSS ile design system kurdum.

EĞİTİM
Bilgisayar Mühendisliği, Lisans — Yıldız Teknik Üniversitesi 2016 - 2020

BECERİLER
React, Next.js, TypeScript, JavaScript, Redux, Tailwind CSS, HTML, CSS, Git, REST, GraphQL, Jest

DİLLER
İngilizce (C1), Türkçe (Anadil)

SERTİFİKALAR
AWS Certified Cloud Practitioner`;

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

async function run() {
  console.log("\n═══ CVMatch başvuru hattı testi ═══\n");

  const pool = getDbPool();

  // ── 1. Kanal tespiti (saf fonksiyon, DB gerektirmez) ────────────────────
  console.log("1) Başvuru kanalı tespiti");

  check(
    "İK adresi bulunuyor",
    findApplicationEmail("CV'nizi ik@ornekfirma.com adresine gönderiniz.") === "ik@ornekfirma.com"
  );
  check(
    "Platform adresi reddediliyor",
    findApplicationEmail("Sorularınız için info@kariyer.net") === undefined,
    "kariyer.net elendi"
  );
  check(
    "noreply reddediliyor",
    findApplicationEmail("Bu ileti noreply@sirket.com adresinden gönderilmiştir.") === undefined
  );
  check(
    "Bağlamsız adres tahmin edilmiyor",
    findApplicationEmail("Ofisimiz Levent'te. muhasebe@sirket.com") === undefined,
    "başvuru bağlamı yok"
  );
  check(
    "E-postasız ilan portal kanalına düşüyor",
    decideApplicationChannel({
      title: "Frontend Developer",
      description: "React bilen geliştirici arıyoruz.",
      requirements: [],
      candidateCriteria: [],
      url: "https://example.com/1"
    }).channel === "portal"
  );

  // ── 2. Yapılandırılmış CV çıkarımı ──────────────────────────────────────
  console.log("\n2) CV bölümlere ayrılıyor");
  const structured = await extractStructuredCv(SAMPLE_CV);

  console.log(`  (kaynak: ${structured.source})`);
  check("Ad soyad çıkarıldı", structured.contact.fullName.includes("Ahmet"), structured.contact.fullName);
  check("E-posta çıkarıldı", structured.contact.email === "ahmet.yilmaz@example.com", structured.contact.email);
  check("Telefon çıkarıldı", Boolean(structured.contact.phone), structured.contact.phone);
  check("Deneyim bulundu", structured.experience.length >= 2, `${structured.experience.length} kayıt`);
  check("Beceri bulundu", structured.skills.length >= 5, `${structured.skills.length} beceri`);
  check("Eğitim bulundu", structured.education.length >= 1, `${structured.education.length} kayıt`);
  check("Dil bulundu", structured.languages.length >= 1, structured.languages.map((l) => l.name).join(", "));

  // ── 3. Uydurma engeli ───────────────────────────────────────────────────
  console.log("\n3) Uydurma engeli (kanıt kontrolü)");

  const listing: TailoringListing = {
    title: "Frontend Developer",
    company: "Test Teknoloji A.Ş.",
    location: "İstanbul",
    platform: "Test",
    description:
      "React ve TypeScript ile modern arayüzler geliştirecek Frontend Developer arıyoruz. " +
      "Kubernetes ve Terraform bilgisi olan adaylar tercih edilir. Docker deneyimi zorunludur. " +
      "Başvurular ik@testteknoloji.com adresine yapılmalıdır.",
    requirements: [
      "React ve TypeScript ile en az 3 yıl deneyim",
      "Kubernetes ve Terraform bilgisi zorunlu",
      "Docker ile konteynerleştirme deneyimi"
    ],
    candidateCriteria: ["Takım çalışmasına yatkın"],
    url: "https://example.com/test-ilan-1"
  };

  const tailoring = await tailorCvForListing({
    masterCv: structured,
    masterText: SAMPLE_CV,
    listing,
    matchScore: 85
  });

  console.log(`  (uyarlama kaynağı: ${tailoring.source})`);
  console.log(`  Öne çıkarılanlar: ${tailoring.tailoredCv.highlightedSkills.join(", ") || "(yok)"}`);
  console.log(`  Eksikler: ${tailoring.gaps.map((g) => g.requirement).join(", ") || "(yok)"}`);

  const highlighted = tailoring.tailoredCv.highlightedSkills.map((s) => s.toLowerCase());
  const allCvText = JSON.stringify(tailoring.tailoredCv).toLowerCase();

  check("React öne çıkarıldı (CV'de var, ilan istiyor)", highlighted.some((s) => s.includes("react")));
  check(
    "Kubernetes CV'ye EKLENMEDİ (CV'de yok)",
    !highlighted.some((s) => s.includes("kubernetes")),
    "uydurma engellendi"
  );
  check("Terraform CV'ye EKLENMEDİ", !highlighted.some((s) => s.includes("terraform")));
  check("Docker CV'ye EKLENMEDİ", !highlighted.some((s) => s.includes("docker")));
  check(
    "Kubernetes uyarlanmış CV'nin hiçbir yerinde geçmiyor",
    !allCvText.includes("kubernetes"),
    "beceri listesi dışında da yok"
  );
  check(
    "Kubernetes eksik raporunda",
    tailoring.gaps.some((gap) => gap.requirement.toLowerCase().includes("kubernetes")),
    "kullanıcıya bildirildi"
  );
  check("Ön yazı üretildi", tailoring.coverLetter.length > 100, `${tailoring.coverLetter.length} karakter`);
  check("E-posta konusu üretildi", tailoring.emailSubject.length > 5, tailoring.emailSubject);
  check("Değişiklik notları var", tailoring.changeNotes.length > 0, `${tailoring.changeNotes.length} not`);

  // hasEvidence birim kontrolü
  const evidenceCases: Array<[string, boolean]> = [
    ["React", true],
    ["TypeScript", true],
    ["Jest", true],
    ["Kubernetes", false],
    ["Terraform", false],
    ["Rust", false]
  ];
  for (const [term, expected] of evidenceCases) {
    const actual = hasEvidence(term, {
      haystack: SAMPLE_CV.toLocaleLowerCase("tr-TR"),
      skills: new Map(structured.skills.map((s) => [s.toLocaleLowerCase("tr-TR"), s]))
    });
    check(`hasEvidence("${term}") = ${expected}`, actual === expected);
  }

  // ── 4. Uçtan uca hat: kullanıcı + CV + gerçek ilanlar ───────────────────
  console.log("\n4) Uçtan uca hat (gerçek ilanlar, gerçek dosyalar)");

  let user = await getUserByEmail(TEST_EMAIL);
  if (!user) {
    user = await registerUser({ fullName: "Pipeline Test", email: TEST_EMAIL, password: "test-password-123" });
    console.log(`  (test kullanıcısı oluşturuldu: #${user.id})`);
  }

  // Otomatik gönderim KAPALI: test hiçbir e-posta göndermez.
  await saveApplicationSettings(user.id, {
    autoApplyEnabled: false,
    minPrepareScore: 0,
    dailySendLimit: 0
  });

  const cvId = await savePrimaryCv({
    userId: user.id,
    rawText: SAMPLE_CV,
    fileType: "pdf",
    fileName: "test-cv.pdf",
    structuredCv: structured
  });
  const storedCv = await getPrimaryCv(user.id);

  check("CV kaydedildi ve okundu", storedCv?.id === cvId, `cv #${cvId}`);

  // Önceki test kalıntılarını temizle ki createApplication yeni kayıt açsın.
  await pool.query(
    "DELETE FROM job_applications WHERE user_id = ? AND listing_url LIKE 'https://example.com/test-ilan%'",
    [user.id]
  );

  const profile: CandidateProfile = {
    targetRole: "Frontend Developer",
    titles: ["Frontend Developer"],
    skills: structured.skills,
    languages: structured.languages.map((l) => l.name),
    industries: ["Teknoloji"],
    experienceAreas: ["Frontend geliştirme"],
    keywords: structured.skills,
    locations: ["Tüm Türkiye"],
    locationMode: "all-turkey",
    workMode: "any",
    fullText: SAMPLE_CV
  };

  const cachedListings = await searchActiveListings(profile);
  console.log(`  (cache'te ${cachedListings.length} aktif ilan bulundu)`);

  // Biri e-postalı biri e-postasız iki sentetik ilan + varsa bir gerçek ilan.
  const results: JobSearchResult[] = [
    {
      id: "test-1",
      kind: "job",
      platform: "Test",
      category: "recommended",
      title: listing.title,
      company: listing.company,
      location: listing.location,
      query: "frontend developer",
      description: listing.description,
      requirements: listing.requirements,
      candidateCriteria: listing.candidateCriteria,
      url: listing.url,
      matchScore: 88,
      matchReasons: ["Test"],
      confidence: "high",
      actionLabel: "İlanı Aç"
    },
    {
      id: "test-2",
      kind: "job",
      platform: "Test",
      category: "general",
      title: "React Developer",
      company: "Portal Only A.Ş.",
      location: "Ankara",
      query: "react developer",
      description: "React ve Next.js bilen geliştirici arıyoruz. Başvurular ilan sayfasından alınır.",
      requirements: ["React", "Next.js"],
      candidateCriteria: [],
      url: "https://example.com/test-ilan-2",
      matchScore: 72,
      matchReasons: ["Test"],
      confidence: "medium",
      actionLabel: "İlanı Aç"
    }
  ];

  const summary = await prepareApplicationsForResults({
    userId: user.id,
    cv: storedCv!,
    results
  });

  console.log(`  Özet: ${JSON.stringify(summary)}`);

  check("2 başvuru paketi hazırlandı", summary.prepared === 2, `prepared=${summary.prepared}`);
  check("Otomatik gönderim yapılmadı (ayar kapalı)", summary.autoSent === 0);
  check("E-postalı ilan onay kuyruğunda", summary.needsReview === 1, `needsReview=${summary.needsReview}`);
  check("E-postasız ilan elle başvuruda", summary.manualRequired === 1, `manualRequired=${summary.manualRequired}`);
  check("Hata yok", summary.failed === 0, `failed=${summary.failed}`);

  const applications = await listApplications(user.id, { limit: 10 });
  const emailApp = applications.find((app) => app.listingUrl === "https://example.com/test-ilan-1");
  const portalApp = applications.find((app) => app.listingUrl === "https://example.com/test-ilan-2");

  check("E-postalı başvuru kaydı var", Boolean(emailApp));
  check("Alıcı adresi doğru", emailApp?.recipientEmail === "ik@testteknoloji.com", emailApp?.recipientEmail);
  check("Kanal e-posta", emailApp?.channel === "email");
  check("Portal başvurusu kanal=portal", portalApp?.channel === "portal");
  check("Portal başvurusu alıcısız", !portalApp?.recipientEmail);

  // ── 5. Üretilen dosyalar ────────────────────────────────────────────────
  console.log("\n5) Üretilen CV dosyaları");

  if (emailApp) {
    check("PDF üretildi", emailApp.hasPdf);
    check("DOCX üretildi", emailApp.hasDocx);

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT pdf_path, docx_path FROM job_applications WHERE id = ?",
      [emailApp.id]
    );

    if (rows[0]?.pdf_path) {
      const pdfStat = await stat(String(rows[0].pdf_path)).catch(() => null);
      check("PDF dosyası diskte ve boş değil", (pdfStat?.size ?? 0) > 1000, `${pdfStat?.size ?? 0} bayt`);
    }

    if (rows[0]?.docx_path) {
      const docxStat = await stat(String(rows[0].docx_path)).catch(() => null);
      check("DOCX dosyası diskte ve boş değil", (docxStat?.size ?? 0) > 1000, `${docxStat?.size ?? 0} bayt`);
    }

    const events = await listApplicationEvents(emailApp.id);
    check("Denetim izi yazıldı", events.length >= 2, `${events.length} olay`);
    console.log(`  Denetim izi: ${events.map((e) => e.eventType).join(" → ")}`);
  }

  // ── 6. Aynı ilana ikinci kez başvurulmuyor ──────────────────────────────
  console.log("\n6) Tekrar başvuru koruması");

  const secondRun = await prepareApplicationsForResults({
    userId: user.id,
    cv: storedCv!,
    results
  });

  check("İkinci turda yeni paket üretilmedi", secondRun.prepared === 0, `prepared=${secondRun.prepared}`);

  const afterSecond = await listApplications(user.id, { limit: 50 });
  const duplicates = afterSecond.filter((app) => app.listingUrl === "https://example.com/test-ilan-1");
  check("Aynı ilan için tek kayıt var", duplicates.length === 1, `${duplicates.length} kayıt`);

  // ── 7. Gönderim koruması ────────────────────────────────────────────────
  console.log("\n7) Gönderim koruması");

  if (portalApp) {
    const { sendPreparedApplication } = await import("../lib/apply/pipeline");
    const error = await sendPreparedApplication(portalApp.id, user.id, { autoApplied: false })
      .then(() => null)
      .catch((err: Error) => err);

    check(
      "Portal başvurusu e-posta ile gönderilemiyor",
      error !== null && /başvuru e-postası yok/i.test(error.message),
      error?.message
    );
  }

  if (emailApp) {
    const { sendPreparedApplication } = await import("../lib/apply/pipeline");
    const error = await sendPreparedApplication(emailApp.id, user.id, { autoApplied: false })
      .then(() => null)
      .catch((err: Error) => err);

    // dailySendLimit=0 olduğu için gönderim reddedilmeli.
    check(
      "Günlük tavan 0 iken gönderim reddediliyor",
      error !== null && /tavan|SMTP/i.test(error.message),
      error?.message
    );

    const after = await getApplication(emailApp.id, user.id);
    check("Reddedilen gönderim 'sent' yapmadı", after?.status !== "sent", after?.status);
  }

  // ── 8. Prova modunda gerçek gönderim yolu ───────────────────────────────
  console.log("\n8) Gönderim yolu (prova modu — ağa çıkılmaz)");

  // SMTP_DRY_RUN, mailer'ı nodemailer'ın jsonTransport'una yönlendirir: mesaj
  // eksiksiz üretilir ama hiçbir ağ bağlantısı açılmaz.
  process.env.SMTP_DRY_RUN = "true";

  await saveApplicationSettings(user.id, {
    autoApplyEnabled: false,
    dailySendLimit: 5,
    senderName: "Ahmet Yılmaz",
    senderEmail: "ahmet.yilmaz@example.com",
    ccSelf: true
  });

  if (emailApp) {
    const { sendPreparedApplication } = await import("../lib/apply/pipeline");
    const sent = await sendPreparedApplication(emailApp.id, user.id, { autoApplied: false })
      .then((app) => ({ app, error: null as Error | null }))
      .catch((error: Error) => ({ app: null, error }));

    check("Gönderim tamamlandı", sent.error === null, sent.error?.message);
    check("Durum 'sent' oldu", sent.app?.status === "sent", sent.app?.status);
    check("Gönderim zamanı yazıldı", Boolean(sent.app?.sentAt));

    const sentEvents = await listApplicationEvents(emailApp.id);
    check(
      "Gönderim denetim izine düştü",
      sentEvents.some((event) => event.eventType === "sent"),
      sentEvents.map((event) => event.eventType).join(" → ")
    );

    const resend = await sendPreparedApplication(emailApp.id, user.id, { autoApplied: false })
      .then(() => null)
      .catch((error: Error) => error);
    check(
      "Aynı başvuru tekrar gönderilemiyor",
      resend !== null && /zaten gönderildi/i.test(resend.message),
      resend?.message
    );
  }

  // ── 9. Otomatik gönderim eşiği ──────────────────────────────────────────
  console.log("\n9) Otomatik gönderim eşiği (prova modu)");

  await saveApplicationSettings(user.id, {
    autoApplyEnabled: true,
    autoApplyMinScore: 80,
    dailySendLimit: 5,
    minPrepareScore: 0,
    smtpHost: "smtp.example.com",
    smtpPort: 465,
    smtpUser: "ahmet.yilmaz@example.com",
    smtpPassword: "prova-sifresi",
    senderEmail: "ahmet.yilmaz@example.com"
  });

  await pool.query(
    "DELETE FROM job_applications WHERE user_id = ? AND listing_url LIKE 'https://example.com/esik-testi%'",
    [user.id]
  );

  const thresholdResults: JobSearchResult[] = [
    {
      ...results[0],
      id: "esik-yuksek",
      title: "Senior Frontend Developer",
      url: "https://example.com/esik-testi-yuksek",
      matchScore: 88,
      confidence: "high"
    },
    {
      ...results[0],
      id: "esik-dusuk",
      title: "Junior Frontend Developer",
      url: "https://example.com/esik-testi-dusuk",
      matchScore: 62,
      confidence: "high"
    },
    {
      ...results[0],
      id: "esik-guvensiz",
      title: "Frontend Developer (AI skoru yok)",
      url: "https://example.com/esik-testi-guvensiz",
      matchScore: 95,
      // AI ile skorlanamamış eşleşme: skoru yüksek olsa da otomatik gitmemeli.
      confidence: "low"
    }
  ];

  const thresholdSummary = await prepareApplicationsForResults({
    userId: user.id,
    cv: storedCv!,
    results: thresholdResults
  });

  console.log(`  Özet: ${JSON.stringify(thresholdSummary)}`);
  check("Eşik üstü (88 puan) otomatik gönderildi", thresholdSummary.autoSent === 1, `autoSent=${thresholdSummary.autoSent}`);
  check(
    "Eşik altı (62) ve düşük güvenli (95) onaya bırakıldı",
    thresholdSummary.needsReview === 2,
    `needsReview=${thresholdSummary.needsReview}`
  );

  const thresholdApps = await listApplications(user.id, { limit: 50 });
  const lowConfidence = thresholdApps.find((app) => app.listingUrl === "https://example.com/esik-testi-guvensiz");
  check(
    "Yüksek skorlu ama AI'sız eşleşme GÖNDERİLMEDİ",
    lowConfidence?.status !== "sent",
    `${lowConfidence?.status} (skor ${lowConfidence?.matchScore})`
  );

  const highScore = thresholdApps.find((app) => app.listingUrl === "https://example.com/esik-testi-yuksek");
  check(
    "Otomatik gönderilen kayıt 'otomatik' olarak işaretlendi",
    highScore?.autoApplied === true && highScore?.status === "sent",
    `${highScore?.status}, auto=${highScore?.autoApplied}`
  );

  delete process.env.SMTP_DRY_RUN;


  // ── Sonuç ───────────────────────────────────────────────────────────────
  console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run()
  .catch((error) => {
    console.error("\nTest çöktü:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDbPool().catch(() => undefined));
