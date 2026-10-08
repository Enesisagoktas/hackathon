import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { closeDbPool } from "../lib/db";
import { filterByLocation } from "../lib/jobs/search-cache";
import { hasRedirectedAwayFromDetail } from "../lib/jobs/verifier";
import { describeSmtpError } from "../lib/apply/mailer";
import type { CandidateProfile, JobListingRecord } from "../lib/jobs/types";
import type { ApplicationSettings } from "../lib/apply/settings";

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

function listing(id: number, location: string | undefined, workMode?: "remote"): JobListingRecord {
  return {
    id,
    sourceId: 1,
    platform: "Test",
    category: "general",
    title: "Test İlanı",
    location,
    workMode,
    description: "açıklama",
    requirements: [],
    candidateCriteria: [],
    externalUrl: `https://example.com/${id}`,
    status: "active"
  };
}

function profile(locations: string[], workMode: CandidateProfile["workMode"] = "any"): CandidateProfile {
  return {
    targetRole: "Hemşire",
    titles: ["Hemşire"],
    skills: [],
    languages: [],
    industries: [],
    experienceAreas: [],
    keywords: [],
    locations,
    locationMode: locations.length ? "cities" : "all-turkey",
    workMode
  };
}

const smtpSettings = (host: string, email: string): ApplicationSettings => ({
  userId: 1,
  autoApplyEnabled: true,
  minMatchScore: 0,
  matchEmailEnabled: false,
  autoApplyMinScore: 80,
  dailySendLimit: 10,
  minPrepareScore: 40,
  smtpHost: host,
  senderEmail: email,
  smtpSecure: true,
  hasSmtpPassword: true,
  ccSelf: true
});

async function run() {
  console.log("\n═══ Düzeltme doğrulama ═══\n");

  // ── 1. İl filtresi ──────────────────────────────────────────────────────
  console.log("1) İl filtresi gerçekten eliyor mu");

  const records = [
    listing(1, "İstanbul(Avrupa)"),
    listing(2, "Ankara (Çankaya)"),
    listing(3, "İzmir, Bornova"),
    listing(4, undefined),
    listing(5, "Bursa", "remote")
  ];

  const ankara = filterByLocation(records, profile(["Ankara"]));
  check("Ankara seçilince İstanbul ilanı elenir", !ankara.some((r) => r.id === 1));
  check("Ankara ilanı kalır", ankara.some((r) => r.id === 2));
  check("Lokasyonu bilinmeyen ilan elenmez", ankara.some((r) => r.id === 4), "şüpheden yararlanır");
  check("Uzaktan çalışılan ilan şehri farklı olsa da kalır", ankara.some((r) => r.id === 5));

  const coklu = filterByLocation(records, profile(["Ankara", "İzmir"]));
  check("Çoklu il seçimi ikisini de tutar", coklu.some((r) => r.id === 2) && coklu.some((r) => r.id === 3));

  const tumTurkiye = filterByLocation(records, profile([]));
  check("Tüm Türkiye modunda hiçbir şey elenmez", tumTurkiye.length === records.length);

  const remoteMode = filterByLocation(records, profile(["Ankara"], "remote"));
  check("Uzaktan modda lokasyon kısıtı uygulanmaz", remoteMode.length === records.length);

  // ── 2. Ölü link tespiti ─────────────────────────────────────────────────
  console.log("\n2) İlan sayfasından ana sayfaya yönlendirme tespiti");

  check(
    "Detaydan arama sayfasına yönlendirme yakalanır",
    hasRedirectedAwayFromDetail(
      "https://www.kariyer.net/is-ilani/perakende-grup-veri-analisti-5012130",
      "https://www.kariyer.net/is-ilanlari"
    ),
    "kullanıcının bildirdiği durum"
  );
  check(
    "Aynı sayfada kalan yönlendirme (http→https) sorun sayılmaz",
    !hasRedirectedAwayFromDetail("http://x.com/is-ilani/abc", "https://www.x.com/is-ilani/abc")
  );
  check(
    "Sondaki eğik çizgi farkı sorun sayılmaz",
    !hasRedirectedAwayFromDetail("https://x.com/is-ilani/abc", "https://x.com/is-ilani/abc/")
  );
  check(
    "Sorgu dizesi eklenmesi sorun sayılmaz",
    !hasRedirectedAwayFromDetail("https://x.com/is-ilani/abc", "https://x.com/is-ilani/abc?utm=1")
  );

  // ── 3. SMTP hata mesajları ──────────────────────────────────────────────
  console.log("\n3) SMTP hataları Türkçeleşiyor mu");

  const dnsError = Object.assign(new Error("getaddrinfo ENOTFOUND smtp.example.com"), { code: "ENOTFOUND" });
  const dnsMsg = describeSmtpError(dnsError, smtpSettings("smtp.example.com", "a@b.com"));
  check("DNS hatası anlaşılır mesaja çevrilir", !/getaddrinfo|ENOTFOUND/.test(dnsMsg), dnsMsg.slice(0, 70));

  const authError = Object.assign(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"), {
    code: "EAUTH",
    responseCode: 535
  });
  const gmailMsg = describeSmtpError(authError, smtpSettings("smtp.gmail.com", "x@gmail.com"));
  check("Gmail kimlik hatası uygulama şifresini anlatır", /Uygulama Şifresi/i.test(gmailMsg), gmailMsg.slice(0, 80));

  const otherAuth = describeSmtpError(authError, smtpSettings("smtp.yandex.com.tr", "x@yandex.com"));
  check("Gmail dışı kimlik hatası da açıklanır", /uygulama şifresi/i.test(otherAuth), otherAuth.slice(0, 60));

  const recipientError = Object.assign(new Error("550 no such user"), { responseCode: 550 });
  const recMsg = describeSmtpError(recipientError, smtpSettings("smtp.x.com", "a@b.com"));
  check("Alıcı reddi ilan sayfasına yönlendirir", /ilan sayfasından/i.test(recMsg), recMsg.slice(0, 70));

  console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run()
  .catch((error) => {
    console.error("Test çöktü:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDbPool().catch(() => undefined));
