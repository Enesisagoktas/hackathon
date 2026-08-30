import mysql from "mysql2/promise";

import { getDbPool } from "@/lib/db";
import { decryptSecret, encryptSecret, hasAppSecret } from "@/lib/apply/secret";
import { isValidEmail } from "@/lib/apply/channel";

/** Kullanıcının otomatik başvuru ayarları. */
export type ApplicationSettings = {
  userId: number;
  autoApplyEnabled: boolean;
  autoApplyMinScore: number;
  dailySendLimit: number;
  /** Feature #4 — kullanıcının sonuç görünüm eşiği (0 = tümü göster). */
  minMatchScore: number;
  minPrepareScore: number;
  senderName?: string;
  senderEmail?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure: boolean;
  smtpUser?: string;
  /** Şifre asla dışarı verilmez; sadece tanımlı olup olmadığı bilinir. */
  hasSmtpPassword: boolean;
  smtpVerifiedAt?: string;
  ccSelf: boolean;
};

export type ApplicationSettingsUpdate = Partial<
  Omit<ApplicationSettings, "userId" | "hasSmtpPassword" | "smtpVerifiedAt">
> & {
  /** Yalnızca yeni bir şifre girildiğinde gönderilir. */
  smtpPassword?: string;
};

const DEFAULTS = {
  autoApplyEnabled: false,
  autoApplyMinScore: 80,
  dailySendLimit: 10,
  // Varsayılan 0: mevcut davranış AYNEN korunur, eşik ancak kullanıcı seçerse devreye girer.
  minMatchScore: 0,
  // 40 seçildi çünkü Gemini anahtarı yokken AI skorlama devre dışı kalır ve
  // yedek (anahtar kelime) skorları 55'te tavanlanır. Eşik 55 olsaydı anahtarsız
  // kurulumda hiçbir başvuru paketi üretilmez, sistem sessizce boş dönerdi.
  // Bu paketler yine de otomatik GÖNDERİLMEZ: düşük güvenli eşleşmeler
  // pipeline'da açıkça engellenir, yalnızca onay kuyruğuna düşerler.
  minPrepareScore: 40,
  smtpSecure: true,
  ccSelf: true
};

export async function getApplicationSettings(userId: number): Promise<ApplicationSettings> {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT * FROM application_settings WHERE user_id = ? LIMIT 1",
    [userId]
  );

  const row = rows[0];

  if (!row) {
    return { userId, hasSmtpPassword: false, ...DEFAULTS };
  }

  return {
    userId,
    autoApplyEnabled: Boolean(row.auto_apply_enabled),
    autoApplyMinScore: Number(row.auto_apply_min_score ?? DEFAULTS.autoApplyMinScore),
    minMatchScore: Number(row.min_match_score ?? DEFAULTS.minMatchScore),
    dailySendLimit: Number(row.daily_send_limit ?? DEFAULTS.dailySendLimit),
    minPrepareScore: Number(row.min_prepare_score ?? DEFAULTS.minPrepareScore),
    senderName: row.sender_name ?? undefined,
    senderEmail: row.sender_email ?? undefined,
    smtpHost: row.smtp_host ?? undefined,
    smtpPort: row.smtp_port != null ? Number(row.smtp_port) : undefined,
    smtpSecure: Boolean(row.smtp_secure),
    smtpUser: row.smtp_user ?? undefined,
    hasSmtpPassword: Boolean(row.smtp_password_encrypted),
    smtpVerifiedAt: row.smtp_verified_at ? new Date(row.smtp_verified_at).toISOString() : undefined,
    ccSelf: Boolean(row.cc_self)
  };
}

export async function saveApplicationSettings(
  userId: number,
  update: ApplicationSettingsUpdate
): Promise<ApplicationSettings> {
  const current = await getApplicationSettings(userId);
  const merged = { ...current, ...update };

  if (merged.senderEmail && !isValidEmail(merged.senderEmail)) {
    throw new Error("Gönderen e-posta adresi geçersiz.");
  }

  // Otomatik gönderim ancak eksiksiz SMTP yapılandırmasıyla açılabilir.
  const willHavePassword = update.smtpPassword ? true : current.hasSmtpPassword;
  if (merged.autoApplyEnabled) {
    const missing = [
      !merged.smtpHost && "SMTP sunucusu",
      !merged.smtpPort && "SMTP portu",
      !merged.smtpUser && "SMTP kullanıcı adı",
      !willHavePassword && "SMTP şifresi",
      !merged.senderEmail && "gönderen e-posta"
    ].filter(Boolean);

    if (missing.length) {
      throw new Error(`Otomatik başvuruyu açmak için şu alanlar gerekli: ${missing.join(", ")}.`);
    }
  }

  let encryptedPassword: Buffer | null | undefined;
  if (update.smtpPassword) {
    if (!hasAppSecret()) {
      throw new Error(
        "SMTP şifresini güvenle saklayabilmek için .env dosyasına en az 32 karakterlik APP_SECRET ekleyin."
      );
    }
    encryptedPassword = encryptSecret(update.smtpPassword);
  }

  const pool = getDbPool();
  await pool.query(
    `INSERT INTO application_settings
       (user_id, auto_apply_enabled, auto_apply_min_score, min_match_score, daily_send_limit, min_prepare_score,
        sender_name, sender_email, smtp_host, smtp_port, smtp_secure, smtp_user,
        smtp_password_encrypted, cc_self)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       auto_apply_enabled = VALUES(auto_apply_enabled),
       auto_apply_min_score = VALUES(auto_apply_min_score),
       min_match_score = VALUES(min_match_score),
       daily_send_limit = VALUES(daily_send_limit),
       min_prepare_score = VALUES(min_prepare_score),
       sender_name = VALUES(sender_name),
       sender_email = VALUES(sender_email),
       smtp_host = VALUES(smtp_host),
       smtp_port = VALUES(smtp_port),
       smtp_secure = VALUES(smtp_secure),
       smtp_user = VALUES(smtp_user),
       -- Yeni şifre gönderilmediyse mevcut şifre korunur.
       smtp_password_encrypted = COALESCE(VALUES(smtp_password_encrypted), smtp_password_encrypted),
       cc_self = VALUES(cc_self),
       updated_at = NOW()`,
    [
      userId,
      merged.autoApplyEnabled,
      clamp(merged.autoApplyMinScore, 0, 100),
      clamp(merged.minMatchScore, 0, 100),
      clamp(merged.dailySendLimit, 0, 100),
      clamp(merged.minPrepareScore, 0, 100),
      merged.senderName ?? null,
      merged.senderEmail ?? null,
      merged.smtpHost ?? null,
      merged.smtpPort ?? null,
      merged.smtpSecure,
      merged.smtpUser ?? null,
      encryptedPassword ?? null,
      merged.ccSelf
    ]
  );

  // Şifre değiştiyse doğrulama damgası düşer; yeniden test edilmeli.
  if (update.smtpPassword) {
    await pool.query("UPDATE application_settings SET smtp_verified_at = NULL WHERE user_id = ?", [userId]);
  }

  return getApplicationSettings(userId);
}

/** Gönderim anında kullanılacak çözülmüş SMTP şifresi. */
export async function getSmtpPassword(userId: number): Promise<string | null> {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT smtp_password_encrypted FROM application_settings WHERE user_id = ? LIMIT 1",
    [userId]
  );

  const payload = rows[0]?.smtp_password_encrypted;

  if (!payload) {
    return null;
  }

  try {
    return decryptSecret(Buffer.isBuffer(payload) ? payload : Buffer.from(payload));
  } catch (error) {
    console.error("[settings] SMTP şifresi çözülemedi:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function markSmtpVerified(userId: number): Promise<void> {
  const pool = getDbPool();
  await pool.query("UPDATE application_settings SET smtp_verified_at = NOW() WHERE user_id = ?", [userId]);
}

/** Bugün gönderilen başvuru sayısı — günlük tavan kontrolü için. */
export async function countSentToday(userId: number): Promise<number> {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS count FROM job_applications WHERE user_id = ? AND status = 'sent' AND sent_at >= CURDATE()",
    [userId]
  );
  return Number(rows[0]?.count ?? 0);
}

function clamp(value: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}
