import { NextResponse } from "next/server";

import { setSessionCookie } from "@/lib/auth/session";
import { AuthError, authenticateUser, isValidEmailAddress, sanitizeEmail } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
    const email = sanitizeEmail(body?.email ?? "");
    const password = body?.password ?? "";

    if (!isValidEmailAddress(email) || !password) {
      return NextResponse.json({ message: "E-posta ve şifre gerekli." }, { status: 400 });
    }

    const user = await authenticateUser(email, password);
    setSessionCookie(user.id);

    return NextResponse.json({ user: { id: user.id, fullName: user.fullName, email: user.email } });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    console.error("Login failed", error);
    return NextResponse.json({ message: "Giriş sırasında hata oluştu." }, { status: 500 });
  }
}
