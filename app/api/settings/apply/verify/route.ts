import { NextResponse } from "next/server";

import { requireSessionUser, UnauthorizedError } from "@/lib/auth/session";
import { getApplicationSettings } from "@/lib/apply/settings";
import { verifySmtpConnection } from "@/lib/apply/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SMTP bağlantısını test eder. E-posta göndermez, sadece kimlik doğrular. */
export async function POST() {
  try {
    const user = await requireSessionUser();
    const settings = await getApplicationSettings(user.id);

    await verifySmtpConnection(settings);

    return NextResponse.json({ ok: true, message: "SMTP bağlantısı doğrulandı." });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ message: error.message }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "SMTP bağlantısı doğrulanamadı.";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
