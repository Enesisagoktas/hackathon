import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { getDbPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RegisterBody = {
  fullName?: string;
  email?: string;
  password?: string;
  kvkkAccepted?: boolean;
  explicitConsentAccepted?: boolean;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as RegisterBody | null;

    if (!body) {
      return errorResponse("Geçerli kayıt bilgileri gönderin.", 400);
    }

    const fullName = sanitizeName(body.fullName ?? "");
    const email = sanitizeEmail(body.email ?? "");
    const password = body.password ?? "";

    if (fullName.length < 3) {
      return errorResponse("Ad soyad en az 3 karakter olmalıdır.", 400);
    }

    if (!isValidEmail(email)) {
      return errorResponse("Geçerli bir e-posta adresi girin.", 400);
    }

    if (password.length < 8) {
      return errorResponse("Şifre en az 8 karakter olmalıdır.", 400);
    }

    if (!body.kvkkAccepted || !body.explicitConsentAccepted) {
      return errorResponse("KVKK aydınlatma metni ve açık rıza kabul edilmelidir.", 400);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const pool = getDbPool();

    await pool.execute(
      `INSERT INTO users (full_name, email, password_hash, kvkk_accepted_at, explicit_consent_accepted_at)
       VALUES (:fullName, :email, :passwordHash, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         full_name = VALUES(full_name),
         password_hash = VALUES(password_hash),
         kvkk_accepted_at = VALUES(kvkk_accepted_at),
         explicit_consent_accepted_at = VALUES(explicit_consent_accepted_at),
         updated_at = NOW()`,
      { fullName, email, passwordHash }
    );

    return NextResponse.json({
      user: {
        fullName,
        email,
        kvkkAccepted: true,
        explicitConsentAccepted: true
      }
    });
  } catch (error) {
    console.error("Registration failed", error);
    return errorResponse("Kayıt oluşturulurken hata oluştu. MySQL bağlantı ve tablo ayarlarını kontrol edin.", 500);
  }
}

function sanitizeName(value: string) {
  return value.replace(/[<>"'`]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function sanitizeEmail(value: string) {
  return value.trim().toLocaleLowerCase("tr-TR").slice(0, 190);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}
