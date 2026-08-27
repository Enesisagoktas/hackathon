import { NextResponse } from "next/server";

import { setSessionCookie } from "@/lib/auth/session";
import {
  AuthError,
  authenticateUser,
  getUserByEmail,
  isValidEmailAddress,
  recordConsent,
  registerUser,
  sanitizeEmail,
  sanitizeName
} from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RegisterBody = {
  fullName?: string;
  email?: string;
  password?: string;
  kvkkAccepted?: boolean;
  explicitConsentAccepted?: boolean;
};

/**
 * Kayıt olur ve oturum açar.
 *
 * E-posta zaten kayıtlıysa hesabın üzerine yazmak yerine aynı şifreyle giriş
 * denenir. Şifre tutmuyorsa 409 döner. (Eski sürüm mevcut hesabın şifresini
 * eziyordu — hesap ele geçirmeye açıktı.)
 */
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

    if (!isValidEmailAddress(email)) {
      return errorResponse("Geçerli bir e-posta adresi girin.", 400);
    }

    if (password.length < 8) {
      return errorResponse("Şifre en az 8 karakter olmalıdır.", 400);
    }

    if (!body.kvkkAccepted || !body.explicitConsentAccepted) {
      return errorResponse("KVKK aydınlatma metni ve açık rıza kabul edilmelidir.", 400);
    }

    const existing = await getUserByEmail(email);

    if (existing) {
      // Aynı kişi tekrar geliyorsa şifresiyle doğrulanır; değilse reddedilir.
      const user = await authenticateUser(email, password);
      await recordConsent(user.id);
      setSessionCookie(user.id);

      return NextResponse.json({
        user: { id: user.id, fullName: user.fullName, email: user.email },
        returning: true
      });
    }

    const user = await registerUser({ fullName, email, password });
    setSessionCookie(user.id);

    return NextResponse.json({
      user: { id: user.id, fullName: user.fullName, email: user.email },
      returning: false
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(
        error.status === 401
          ? "Bu e-posta zaten kayıtlı ancak şifre eşleşmedi. Mevcut şifrenizle giriş yapın."
          : error.message,
        error.status
      );
    }

    console.error("Registration failed", error);
    return errorResponse("Kayıt oluşturulurken hata oluştu. MySQL bağlantı ve tablo ayarlarını kontrol edin.", 500);
  }
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}
