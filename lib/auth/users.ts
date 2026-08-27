import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

import { getDbPool } from "@/lib/db";

export type AppUser = {
  id: number;
  fullName: string;
  email: string;
  kvkkAcceptedAt?: string;
  explicitConsentAcceptedAt?: string;
};

export class AuthError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

/**
 * Yeni kullanıcı oluşturur.
 *
 * GÜVENLİK: Eski sürüm `ON DUPLICATE KEY UPDATE password_hash = VALUES(...)`
 * kullanıyordu; bu, var olan bir e-postayla kayıt olan herkesin o hesabın
 * şifresini ezmesine — yani hesap ele geçirmeye — izin veriyordu. Artık var
 * olan e-posta için kayıt reddedilir, kullanıcı girişe yönlendirilir.
 */
export async function registerUser(input: {
  fullName: string;
  email: string;
  password: string;
}): Promise<AppUser> {
  const pool = getDbPool();
  const passwordHash = await bcrypt.hash(input.password, 12);

  try {
    const [result] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO users (full_name, email, password_hash, kvkk_accepted_at, explicit_consent_accepted_at)
       VALUES (?, ?, ?, NOW(), NOW())`,
      [input.fullName, input.email, passwordHash]
    );

    return { id: result.insertId, fullName: input.fullName, email: input.email };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AuthError("Bu e-posta ile zaten bir hesap var. Lütfen giriş yapın.", 409);
    }
    throw error;
  }
}

/** E-posta + şifre doğrular. Hangi alanın yanlış olduğunu sızdırmaz. */
export async function authenticateUser(email: string, password: string): Promise<AppUser> {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, full_name, email, password_hash, kvkk_accepted_at, explicit_consent_accepted_at FROM users WHERE email = ? LIMIT 1",
    [email]
  );

  const row = rows[0];

  // Kullanıcı yoksa da bcrypt çalıştırılır: yanıt süresinden hesap varlığı anlaşılmasın.
  const hash = row?.password_hash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin";
  const valid = await bcrypt.compare(password, hash);

  if (!row || !valid) {
    throw new AuthError("E-posta veya şifre hatalı.", 401);
  }

  return mapUserRow(row);
}

export async function getUserById(userId: number): Promise<AppUser | null> {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, full_name, email, kvkk_accepted_at, explicit_consent_accepted_at FROM users WHERE id = ? LIMIT 1",
    [userId]
  );

  return rows[0] ? mapUserRow(rows[0]) : null;
}

export async function getUserByEmail(email: string): Promise<AppUser | null> {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, full_name, email, kvkk_accepted_at, explicit_consent_accepted_at FROM users WHERE email = ? LIMIT 1",
    [email]
  );

  return rows[0] ? mapUserRow(rows[0]) : null;
}

export async function recordConsent(userId: number): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    "UPDATE users SET kvkk_accepted_at = NOW(), explicit_consent_accepted_at = NOW(), updated_at = NOW() WHERE id = ?",
    [userId]
  );
}

export function sanitizeName(value: string): string {
  return value.replace(/[<>"'`]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function sanitizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR").slice(0, 190);
}

export function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function mapUserRow(row: mysql.RowDataPacket): AppUser {
  return {
    id: Number(row.id),
    fullName: String(row.full_name ?? ""),
    email: String(row.email ?? ""),
    kvkkAcceptedAt: row.kvkk_accepted_at ? new Date(row.kvkk_accepted_at).toISOString() : undefined,
    explicitConsentAcceptedAt: row.explicit_consent_accepted_at
      ? new Date(row.explicit_consent_accepted_at).toISOString()
      : undefined
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ER_DUP_ENTRY";
}
