import path from "path";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { closeDbPool, getDbPool } from "../lib/db";

/**
 * §23 — Gönderim öncesi son kontrol.
 *
 * Paket hazırlandıktan sonra ilan kapanmış olabilir; kapanmış bir ilana
 * e-posta göndermek işe yaramaz ve kullanıcının itibarına zarar verir.
 */

let passed = 0, failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  console.log("\n═══ Gönderim öncesi son kontrol ═══\n");
  const pool = getDbPool();
  const stamp = Date.now();

  const reg = await fetch("http://localhost:3000/api/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "Son Kontrol", email: `presend-${stamp}@cvmatch.local`,
      password: "presend-parola-123", kvkkAccepted: true, explicitConsentAccepted: true
    })
  });
  const user = (await reg.json()).user;
  check("Test kullanıcısı oluşturuldu", reg.ok, `#${user?.id}`);

  // Kapanmış bir ilan ve ona bağlı hazır bir başvuru paketi
  const [srcRows] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM job_sources LIMIT 1");
  const sourceId = srcRows[0]?.id ?? 1;

  const [listing] = await pool.query<mysql.ResultSetHeader>(
    `INSERT INTO job_listings (source_id, title, company, external_url, status, first_seen_at, last_seen_at)
     VALUES (?, 'Kapanmış Test İlanı', 'Test A.Ş.', ?, 'expired', NOW(), NOW())`,
    [sourceId, `https://example.com/kapali-${stamp}`]
  );

  const cv = JSON.stringify({
    contact: { fullName: "Son Kontrol", links: [] }, headline: "Test", summary: "",
    highlightedSkills: [], adjacentSkills: [], skillGroups: [], experience: [],
    education: [], certifications: [], languages: [], projects: [], source: "ai"
  });

  const [app] = await pool.query<mysql.ResultSetHeader>(
    `INSERT INTO job_applications
       (user_id, listing_id, listing_title, listing_company, listing_url, match_score, status,
        channel, recipient_email, recipient_source, cover_letter, email_subject, tailored_cv)
     VALUES (?, ?, 'Kapanmış Test İlanı', 'Test A.Ş.', ?, 88, 'needs_review',
        'email', 'ik@testsirket.com', 'listing', 'Ön yazı metni.', 'Başvuru', ?)`,
    [user.id, listing.insertId, `https://example.com/kapali-${stamp}`, cv]
  );

  process.env.SMTP_DRY_RUN = "true";
  const { saveApplicationSettings } = await import("../lib/apply/settings");
  await saveApplicationSettings(user.id, { senderEmail: "aday@example.com", dailySendLimit: 5 });

  const { sendPreparedApplication } = await import("../lib/apply/pipeline");
  const result = await sendPreparedApplication(app.insertId, user.id, { autoApplied: true })
    .then(() => null)
    .catch((e: Error) => e);

  check("Kapanmış ilana gönderim engellendi", result !== null, result?.message.slice(0, 60));
  check("Mesaj kullanıcıya anlaşılır", /yay[ıi]ndan kalk/i.test(result?.message ?? ""), result?.message);

  const [after] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT status FROM job_applications WHERE id = ?", [app.insertId]
  );
  check("Başvuru 'skipped' işaretlendi", after[0]?.status === "skipped", String(after[0]?.status));

  // Gerekçe denetim izine yazılır (mevcut tasarım: error_message değil, olay kaydı).
  const [events] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT message FROM application_events WHERE application_id = ? ORDER BY id DESC LIMIT 3",
    [app.insertId]
  );
  check(
    "Sebep denetim izine yazıldı",
    events.some((e) => /yay[ıi]ndan kalk/i.test(String(e.message ?? ""))),
    String(events[0]?.message ?? "").slice(0, 55)
  );

  // Karşı kontrol: AĞ HATASI gönderimi ENGELLEMEMELİ.
  //
  // Çözülemeyen bir alan adı kullanılıyor: doğrulama yapılamaması, ilanın
  // kapandığı anlamına gelmez ve kullanıcı geçici bir sorun yüzünden
  // fırsattan olmamalı. (Gerçekten 404 dönen ilan ise yukarıda engelleniyor.)
  const [openListing] = await pool.query<mysql.ResultSetHeader>(
    `INSERT INTO job_listings (source_id, title, company, external_url, status, first_seen_at, last_seen_at)
     VALUES (?, 'Açık Test İlanı', 'Test A.Ş.', ?, 'active', NOW(), NOW())`,
    [sourceId, `https://bu-alan-adi-kesinlikle-yok-${stamp}.invalid/ilan`]
  );
  const [app2] = await pool.query<mysql.ResultSetHeader>(
    `INSERT INTO job_applications
       (user_id, listing_id, listing_title, listing_company, listing_url, match_score, status,
        channel, recipient_email, recipient_source, cover_letter, email_subject, tailored_cv)
     VALUES (?, ?, 'Açık Test İlanı', 'Test A.Ş.', ?, 88, 'needs_review',
        'email', 'ik@testsirket.com', 'listing', 'Ön yazı metni.', 'Başvuru', ?)`,
    [user.id, openListing.insertId, `https://bu-alan-adi-kesinlikle-yok-${stamp}.invalid/ilan`, cv]
  );

  const ok = await sendPreparedApplication(app2.insertId, user.id, { autoApplied: false })
    .then((a) => ({ app: a, error: null as Error | null }))
    .catch((e: Error) => ({ app: null, error: e }));

  check("Ağ hatası gönderimi engellemez", ok.error === null, ok.error?.message.slice(0, 70));
  check("Gönderim tamamlandı", ok.app?.status === "sent", ok.app?.status);
  delete process.env.SMTP_DRY_RUN;

  await pool.query("DELETE FROM job_applications WHERE user_id = ?", [user.id]);
  await pool.query("DELETE FROM job_listings WHERE id IN (?, ?)", [listing.insertId, openListing.insertId]);
  await pool.query("DELETE FROM users WHERE id = ?", [user.id]);

  console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error("Test çöktü:", e); process.exitCode = 1; })
  .finally(() => closeDbPool().catch(() => undefined));
