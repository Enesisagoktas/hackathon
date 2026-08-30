import "../lib/load-env";

import mysql from "mysql2/promise";

import { isDryRun, sendDigestEmail } from "../lib/apply/mailer";
import { getApplicationSettings } from "../lib/apply/settings";
import { closeDbPool, getDbPool } from "../lib/db";
import type { AiExtractedProfile } from "../lib/extract-keywords";
import { parseJsonField } from "../lib/job-queue";
import { dedupeListings, fingerprint as listingFingerprint } from "../lib/jobs/dedupe";
import { buildCandidateEligibility, evaluateEligibility } from "../lib/jobs/eligibility";
import { searchActiveListings } from "../lib/jobs/repository";
import { extractRoleRequirements } from "../lib/jobs/requirement-parser";
import type { CandidateProfile, JobListingRecord } from "../lib/jobs/types";
import { normalizeCities, normalizeLocationMode, normalizeWorkMode } from "../lib/search-preferences";

/**
 * Feature #10 — Yeni eşleşme özeti e-postası.
 *
 * Eşleşme e-postasını AÇMIŞ kullanıcılar için, son aramalarındaki kriterlere
 * göre pencere içinde cache'e YENİ giren ilanları DETERMİNİSTİK motorla
 * (şart çıkarımı + uygunluk; AI ÇAĞRISI YOK) puanlar ve uygun olanları tek
 * özet e-postasıyla kullanıcının KENDİ adresine gönderir.
 *
 * Güvenlik sınırları:
 *   - Varsayılan kapalı; yalnızca match_email_enabled=1 kullanıcılar.
 *   - Alıcı her zaman kullanıcının kayıtlı üyelik e-postası — dışarı gitmez.
 *   - SMTP_DRY_RUN=true iken hiçbir e-posta ağa çıkmaz (prova loglanır) ve
 *     bildirim kaydı YAZILMAZ (gerçek gönderimde ilk tur eksiksiz gitsin).
 *   - notified_matches (user_id + dedupe kanonik anahtarı) ikinci bildirimi
 *     engeller; aynı ilan başka kaynaktan tekrar gelse bile.
 *   - Otomatik başvuru TETİKLENMEZ — bu yalnızca bilgilendirme e-postasıdır.
 *
 * Kullanım: npm run notify:matches (gecelik bakımdan/zamanlayıcıdan sonra).
 */

const WINDOW_HOURS = readPositive(process.env.NOTIFY_WINDOW_HOURS, 24);
const MAX_PER_DIGEST = readPositive(process.env.NOTIFY_MAX_MATCHES, 10);
/** Kullanıcı eşiği 0 (kapalı) olsa bile özet e-postası bu tabanın altını yollamaz. */
const QUALITY_FLOOR = 50;

function readPositive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

type EligibleMatch = {
  listing: JobListingRecord;
  canonicalKey: string;
  totalScore: number;
};

async function collectMatchesForUser(userId: number, minMatchScore: number): Promise<{
  matches: EligibleMatch[];
  targetRole: string;
} | null> {
  const pool = getDbPool();

  // Hedef kriterler kullanıcının SON tamamlanmış aramasından okunur: pozisyon
  // seçimi, konum ve çalışma şekli tercihleri orada güncel haliyle durur.
  const [searchRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT ai_profile, selected_positions, location_mode, cities, work_mode
     FROM job_searches
     WHERE user_id = ? AND status = 'completed' AND ai_profile IS NOT NULL
     ORDER BY completed_at DESC
     LIMIT 1`,
    [userId]
  );

  const searchRow = searchRows[0];

  if (!searchRow) {
    return null;
  }

  const extractedRaw = parseJsonField<AiExtractedProfile | { aiProfile: AiExtractedProfile } | null>(
    searchRow.ai_profile,
    null
  );
  // Bazı eski kayıtlar profili {aiProfile: {...}} sarmalayıcısıyla tutar.
  const extracted =
    extractedRaw && "skills" in extractedRaw
      ? (extractedRaw as AiExtractedProfile)
      : ((extractedRaw as { aiProfile?: AiExtractedProfile } | null)?.aiProfile ?? null);

  if (!extracted || !Array.isArray(extracted.skills)) {
    return null;
  }

  const selectedPositions = parseJsonField<string[]>(searchRow.selected_positions, []).filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
  const ai = extracted.aiProfile ?? ({} as AiExtractedProfile["aiProfile"]);

  const targetRole = selectedPositions[0] ?? ai.targetPositions?.[0] ?? extracted.titles?.[0] ?? "Genel";

  const profile: CandidateProfile = {
    targetRole,
    titles: unique([...selectedPositions, ...(extracted.titles ?? [])]).slice(0, 8),
    skills: (extracted.skills ?? []).slice(0, 12),
    languages: extracted.languages ?? [],
    industries: extracted.industries ?? [],
    experienceAreas: extracted.experienceAreas ?? [],
    keywords: (extracted.searchKeywords ?? []).slice(0, 30),
    locations: normalizeCities(parseJsonField<unknown[]>(searchRow.cities, [])),
    locationMode: normalizeLocationMode(searchRow.location_mode),
    workMode: normalizeWorkMode(searchRow.work_mode),
    seniority: ai.seniority,
    yearsOfExperience: ai.yearsOfExperience,
    targetPositions: ai.targetPositions,
    certifications: ai.certifications,
    educationLevel: ai.educationLevel,
    preferredRoles: ai.preferredRoles,
    professionCategory: ai.professionCategory
  };

  // Adayla alakalı aktif ilan havuzu (mevcut cache araması aynen yeniden kullanılır).
  const candidates = await searchActiveListings(profile);

  if (!candidates.length) {
    return { matches: [], targetRole };
  }

  // Pencere filtresi: yalnızca cache'e YENİ giren ilanlar bildirilir.
  const [newRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id FROM job_listings WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)",
    [Math.round(WINDOW_HOURS * 60)]
  );
  const newIds = new Set(newRows.map((row) => Number(row.id)));
  const freshRecords = candidates.filter((listing) => newIds.has(listing.id));

  if (!freshRecords.length) {
    return { matches: [], targetRole };
  }

  // Kopya farkındalığı: aynı ilan birden çok kaynaktan geldiyse tek temsilci kalır.
  const { unique: freshUnique } = dedupeListings(
    freshRecords.map((listing) => ({
      url: listing.externalUrl,
      title: listing.title,
      company: listing.company,
      location: listing.location,
      description: listing.description,
      listing
    }))
  );

  // Daha önce bildirilenler düşülür (kanonik anahtar üzerinden, kaynak bağımsız).
  const [notifiedRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT canonical_key FROM notified_matches WHERE user_id = ?",
    [userId]
  );
  const alreadyNotified = new Set(notifiedRows.map((row) => String(row.canonical_key)));

  const candidateElig = buildCandidateEligibility(profile);
  const threshold = Math.max(minMatchScore, QUALITY_FLOOR);
  const matches: EligibleMatch[] = [];

  for (const item of freshUnique) {
    const listing = item.listing;
    const canonicalKey = listingFingerprint(listing).slice(0, 190);

    if (alreadyNotified.has(canonicalKey)) {
      continue;
    }

    // Deterministik değerlendirme — AI karışmaz, hard filter'lar aynen geçerli.
    const role = extractRoleRequirements({
      title: listing.title,
      description: listing.description,
      requirements: listing.requirements,
      candidateCriteria: listing.candidateCriteria,
      location: listing.location
    });
    const result = evaluateEligibility(role, candidateElig, {
      listingVerified: true,
      listingKeywords: [listing.title]
    });

    if (result.eligible && result.totalScore >= threshold) {
      matches.push({ listing, canonicalKey, totalScore: result.totalScore });
    }
  }

  matches.sort((a, b) => b.totalScore - a.totalScore);
  return { matches: matches.slice(0, MAX_PER_DIGEST), targetRole };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildDigestBodies(matches: EligibleMatch[], targetRole: string): { text: string; html: string } {
  const lines = matches.map(
    (match, index) =>
      `${index + 1}. ${match.listing.title}` +
      `${match.listing.company ? ` — ${match.listing.company}` : ""}` +
      `${match.listing.location ? ` (${match.listing.location})` : ""}` +
      ` | uyum ~%${match.totalScore}\n   ${match.listing.externalUrl}`
  );

  const text =
    `Merhaba,\n\n"${targetRole}" aramana uyan ${matches.length} yeni ilan bulundu:\n\n` +
    lines.join("\n\n") +
    "\n\nPuanlar ilanın şartlarına göre otomatik hesaplanır; ayrıntıları ve başvuru paketini CVMatch'te görebilirsin." +
    "\nBu özeti almak istemiyorsan Ayarlar sayfasından 'Yeni eşleşme e-postası' seçeneğini kapatabilirsin.\n";

  const items = matches
    .map(
      (match) =>
        `<li style="margin:0 0 12px;">` +
        `<a href="${escapeHtml(match.listing.externalUrl)}" style="font-weight:600;color:#0f766e;">${escapeHtml(match.listing.title)}</a>` +
        `${match.listing.company ? ` — ${escapeHtml(match.listing.company)}` : ""}` +
        `${match.listing.location ? ` <span style="color:#64748b;">(${escapeHtml(match.listing.location)})</span>` : ""}` +
        ` <span style="color:#0f766e;">~%${match.totalScore} uyum</span>` +
        `</li>`
    )
    .join("");

  const html =
    `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2933;">` +
    `<p>Merhaba,</p><p>&quot;${escapeHtml(targetRole)}&quot; aramana uyan <strong>${matches.length} yeni ilan</strong> bulundu:</p>` +
    `<ol style="padding-left:18px;">${items}</ol>` +
    `<p style="color:#64748b;font-size:12px;">Puanlar ilan şartlarına göre otomatik hesaplanır. Bu özeti almak istemiyorsan Ayarlar sayfasından &quot;Yeni eşleşme e-postası&quot; seçeneğini kapat.</p>` +
    `</div>`;

  return { text, html };
}

async function main() {
  const pool = getDbPool();

  const [userRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT s.user_id, u.email, u.full_name
     FROM application_settings s
     JOIN users u ON u.id = s.user_id
     WHERE s.match_email_enabled = 1`
  );

  console.log(
    `\n═══ Eşleşme özeti turu — ${userRows.length} abone, pencere ${WINDOW_HOURS} saat${isDryRun() ? " (PROVA MODU)" : ""} ═══\n`
  );

  let sent = 0;
  let skipped = 0;
  let failedCount = 0;

  for (const userRow of userRows) {
    const userId = Number(userRow.user_id);
    const email = String(userRow.email ?? "");

    try {
      if (!email) {
        skipped += 1;
        continue;
      }

      const settings = await getApplicationSettings(userId);
      const collected = await collectMatchesForUser(userId, settings.minMatchScore);

      if (!collected) {
        console.log(`  – #${userId}: tamamlanmış arama/profil yok, atlandı.`);
        skipped += 1;
        continue;
      }

      if (!collected.matches.length) {
        console.log(`  – #${userId}: pencere içinde yeni uygun ilan yok.`);
        skipped += 1;
        continue;
      }

      const { text, html } = buildDigestBodies(collected.matches, collected.targetRole);

      await sendDigestEmail({
        settings,
        to: email,
        subject: `CVMatch: ${collected.matches.length} yeni eşleşme — ${collected.targetRole}`,
        text,
        html
      });

      // Prova modunda bildirim kaydı yazılmaz: gerçek gönderim açıldığında
      // aynı ilanlar ilk gerçek özete eksiksiz girer.
      if (!isDryRun()) {
        for (const match of collected.matches) {
          await pool.query(
            "INSERT IGNORE INTO notified_matches (user_id, canonical_key, listing_id) VALUES (?, ?, ?)",
            [userId, match.canonicalKey, match.listing.id]
          );
        }
      }

      console.log(`  ✓ #${userId} (${email}): ${collected.matches.length} eşleşme gönderildi.`);
      sent += 1;
    } catch (error) {
      // Tek kullanıcının SMTP hatası turu düşürmez.
      console.error(`  ✗ #${userId}: ${error instanceof Error ? error.message : error}`);
      failedCount += 1;
    }
  }

  console.log(`\n═══ Özet: ${sent} gönderildi, ${skipped} atlandı, ${failedCount} hata ═══\n`);

  if (failedCount > 0 && sent === 0 && userRows.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Eşleşme özeti turu çöktü:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDbPool().catch(() => undefined));
