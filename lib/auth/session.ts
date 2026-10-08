import { createHmac, timingSafeEqual } from "crypto";

import { cookies } from "next/headers";

import { getUserById, type AppUser } from "@/lib/auth/users";

/**
 * İmzalı çerez tabanlı oturum.
 *
 * Başvurular kullanıcı adına gerçek e-posta gönderdiği için "bu başvuru kimin"
 * sorusunun güvenilir bir cevabı olmalı. Eski akışta kimlik, istekle birlikte
 * gelen düz `userEmail` alanıydı — herkes başkasının e-postasını yazıp onun
 * başvurularını okuyabilirdi. Artık kimlik, sunucunun HMAC ile imzaladığı
 * HttpOnly çerezden okunur.
 */

const COOKIE_NAME = "cvmatch_session";
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 7);

export class UnauthorizedError extends Error {
  status = 401;

  constructor(message = "Bu işlem için giriş yapmanız gerekiyor.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function getSecret(): string {
  const secret = process.env.APP_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "APP_SECRET tanımlı değil veya çok kısa. Oturum imzalamak için .env dosyasına en az 32 karakterlik bir APP_SECRET ekleyin."
    );
  }

  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/** Token biçimi: `<userId>.<expiresAtSeconds>.<hmac>` */
function createToken(userId: number): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token: string): number | null {
  const parts = token.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [rawUserId, rawExpiresAt, signature] = parts;
  const payload = `${rawUserId}.${rawExpiresAt}`;

  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);

  // Uzunluklar farklıysa timingSafeEqual hata fırlatır; önce onu eleriz.
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  const expiresAt = Number(rawExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) {
    return null;
  }

  const userId = Number(rawUserId);
  return Number.isFinite(userId) && userId > 0 ? userId : null;
}

export function setSessionCookie(userId: number): void {
  cookies().set(COOKIE_NAME, createToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
}

export function clearSessionCookie(): void {
  cookies().delete(COOKIE_NAME);
}

/** Oturumdaki kullanıcı id'si; oturum yoksa null. */
export function getSessionUserId(): number | null {
  const token = cookies().get(COOKIE_NAME)?.value;
  return token ? verifyToken(token) : null;
}

/** Oturumdaki kullanıcı; yoksa null. */
export async function getSessionUser(): Promise<AppUser | null> {
  const userId = getSessionUserId();
  return userId ? getUserById(userId) : null;
}

/** Oturum zorunlu olan uçlar için: kullanıcı yoksa 401 fırlatır. */
export async function requireSessionUser(): Promise<AppUser> {
  const user = await getSessionUser();

  if (!user) {
    throw new UnauthorizedError();
  }

  return user;
}
