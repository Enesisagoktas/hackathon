import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * SMTP şifresi gibi geri döndürülebilir olması gereken sırların şifrelenmesi.
 *
 * Kullanıcı şifreleri (users.password_hash) bcrypt ile HASH'lenir — onlar
 * asla çözülmez. SMTP şifresi ise gönderim anında düz metin gerektiği için
 * AES-256-GCM ile şifrelenip saklanır.
 *
 * Anahtar `APP_SECRET` ortam değişkeninden türetilir. APP_SECRET yoksa
 * şifreleme reddedilir — sır düz metin olarak DB'ye yazılmaz.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export class MissingAppSecretError extends Error {
  constructor() {
    super(
      "APP_SECRET tanımlı değil. SMTP şifresini güvenle saklayabilmek için .env dosyasına en az 32 karakterlik bir APP_SECRET ekleyin."
    );
    this.name = "MissingAppSecretError";
  }
}

function getKey(): Buffer {
  const secret = process.env.APP_SECRET;

  if (!secret || secret.length < 32) {
    throw new MissingAppSecretError();
  }

  // Sabit uzunlukta anahtar için SHA-256 türetmesi.
  return createHash("sha256").update(secret).digest();
}

export function hasAppSecret(): boolean {
  const secret = process.env.APP_SECRET;
  return Boolean(secret && secret.length >= 32);
}

/** Düz metni şifreler. Çıktı: [iv(12) | authTag(16) | ciphertext]. */
export function encryptSecret(plainText: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);

  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

/** `encryptSecret` çıktısını çözer. Bozuk/kurcalanmış veride hata fırlatır. */
export function decryptSecret(payload: Buffer): string {
  if (payload.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Şifrelenmiş SMTP verisi geçersiz uzunlukta.");
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
