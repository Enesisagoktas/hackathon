import path from "path";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { closeDbPool, getDbPool } from "../lib/db";

/** Elle İK adresi girip portal başvurusunu gönderilebilir hale getirme akışı. */
const BASE_URL = "http://localhost:3000";

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
  console.log("\n═══ Elle adres girme + gönderim akışı ═══\n");

  const pool = getDbPool();
  const email = `recipient-test-${Date.now()}@cvmatch.local`;

  const reg = await fetch(`${BASE_URL}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Alıcı Testi",
      email,
      password: "alici-parola-123",
      kvkkAccepted: true,
      explicitConsentAccepted: true
    })
  });
  const cookie = (reg.headers.get("set-cookie") ?? "").split(";")[0];
  const user = (await reg.json()).user;
  check("Test kullanıcısı oluşturuldu", reg.ok, `#${user?.id}`);

  const call = (p: string, init: RequestInit = {}) =>
    fetch(`${BASE_URL}${p}`, { ...init, headers: { ...(init.headers ?? {}), Cookie: cookie } });

  // Portal kanallı bir başvuru kaydı üret
  const [ins] = await pool.query<mysql.ResultSetHeader>(
    `INSERT INTO job_applications
       (user_id, listing_title, listing_company, listing_url, match_score, status, channel,
        cover_letter, email_subject, tailored_cv)
     VALUES (?, 'Test Hemşire İlanı', 'Test Hastanesi', ?, 85, 'manual_required', 'portal',
        'Merhaba, başvurumu iletiyorum.', 'Hemşire Başvurusu', '{"contact":{"fullName":"Test"},"headline":"Hemşire","summary":"","highlightedSkills":[],"adjacentSkills":[],"skillGroups":[],"experience":[],"education":[],"certifications":[],"languages":[],"projects":[],"source":"ai"}')`,
    [user.id, `https://example.com/ilan-${Date.now()}`]
  );
  const appId = ins.insertId;
  console.log(`  (portal başvurusu oluşturuldu: #${appId})\n`);

  // 1. Gönderim, adres yokken reddedilmeli
  const early = await call(`/api/applications/${appId}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const earlyBody = await early.json();
  check("Adres yokken gönderim reddediliyor", !early.ok, String(earlyBody.message).slice(0, 70));

  // 2. İlan sitesi adresi reddedilmeli
  const blocked = await call(`/api/applications/${appId}/recipient`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "ik@kariyer.net" })
  });
  const blockedBody = await blocked.json();
  check("İlan sitesi adresi reddediliyor", !blocked.ok, String(blockedBody.message).slice(0, 60));

  // 3. Geçersiz adres reddedilmeli
  const invalid = await call(`/api/applications/${appId}/recipient`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "bu-bir-eposta-degil" })
  });
  check("Geçersiz adres reddediliyor", !invalid.ok);

  // 4. Geçerli İK adresi kabul edilmeli
  const ok = await call(`/api/applications/${appId}/recipient`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "ik@testhastanesi.com" })
  });
  const okBody = await ok.json();
  check("Geçerli İK adresi kaydediliyor", ok.ok, okBody.message);

  // 5. Kayıt sonrası kanal ve durum değişmeli
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT channel, status, recipient_email, recipient_source FROM job_applications WHERE id = ?",
    [appId]
  );
  check("Kanal e-postaya geçti", rows[0]?.channel === "email", String(rows[0]?.channel));
  check("Durum onay bekliyora geçti", rows[0]?.status === "needs_review", String(rows[0]?.status));
  check("Kaynak 'manual' olarak işaretlendi", rows[0]?.recipient_source === "manual");

  // 6. Otomatik gönderim elle adrese YASAK
  const { sendPreparedApplication } = await import("../lib/apply/pipeline");
  const autoError = await sendPreparedApplication(appId, user.id, { autoApplied: true })
    .then(() => null)
    .catch((e: Error) => e);
  check(
    "Elle girilen adrese OTOMATİK gönderim engelleniyor",
    autoError !== null && /otomatik gönderim yapılmaz/i.test(autoError.message),
    autoError?.message.slice(0, 60)
  );

  // 7. Dosya diskte yokken gönderim: boru hattı CV'yi yeniden üretmeli
  process.env.SMTP_DRY_RUN = "true";
  const { saveApplicationSettings } = await import("../lib/apply/settings");
  await saveApplicationSettings(user.id, { senderEmail: "aday@example.com", dailySendLimit: 5 });

  const sent = await sendPreparedApplication(appId, user.id, { autoApplied: false })
    .then((app) => ({ app, error: null as Error | null }))
    .catch((e: Error) => ({ app: null, error: e }));
  check("Dosya yokken CV yeniden üretilip gönderiliyor", sent.error === null, sent.error?.message.slice(0, 80));
  check("Durum 'sent' oldu", sent.app?.status === "sent", sent.app?.status);

  const [fileRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT pdf_path, docx_path FROM job_applications WHERE id = ?",
    [appId]
  );
  check("Yeniden üretilen dosya yolları kaydedildi", Boolean(fileRows[0]?.pdf_path || fileRows[0]?.docx_path));
  delete process.env.SMTP_DRY_RUN;

  // Temizlik
  await pool.query("DELETE FROM job_applications WHERE user_id = ?", [user.id]);
  await pool.query("DELETE FROM users WHERE id = ?", [user.id]);

  console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
  if (failed > 0) process.exitCode = 1;
}

run()
  .catch((error) => {
    console.error("Test çöktü:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDbPool().catch(() => undefined));
