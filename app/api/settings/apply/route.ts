import { NextResponse } from "next/server";

import { requireSessionUser, UnauthorizedError } from "@/lib/auth/session";
import { getApplicationSettings, saveApplicationSettings } from "@/lib/apply/settings";
import { hasAppSecret } from "@/lib/apply/secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const settings = await getApplicationSettings(user.id);

    return NextResponse.json({
      settings,
      appSecretConfigured: hasAppSecret(),
      // Gemini anahtarı yoksa profil çıkarımı, skorlama ve CV uyarlaması
      // kural tabanlı yedeğe düşer. Kullanıcı bunu bilmeli.
      aiConfigured: Boolean(process.env.GEMINI_API_KEY)
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ message: error.message }, { status: 401 });
    }

    console.error("Read apply settings failed", error);
    return NextResponse.json({ message: "Ayarlar okunamadı." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireSessionUser();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (!body) {
      return NextResponse.json({ message: "Geçerli bir ayar gövdesi gönderin." }, { status: 400 });
    }

    const settings = await saveApplicationSettings(user.id, {
      autoApplyEnabled: toBoolean(body.autoApplyEnabled),
      autoApplyMinScore: toNumber(body.autoApplyMinScore),
      minMatchScore: toNumber(body.minMatchScore),
      dailySendLimit: toNumber(body.dailySendLimit),
      minPrepareScore: toNumber(body.minPrepareScore),
      senderName: toStringOrUndefined(body.senderName),
      senderEmail: toStringOrUndefined(body.senderEmail),
      smtpHost: toStringOrUndefined(body.smtpHost),
      smtpPort: toNumber(body.smtpPort),
      smtpSecure: toBoolean(body.smtpSecure),
      smtpUser: toStringOrUndefined(body.smtpUser),
      smtpPassword: toStringOrUndefined(body.smtpPassword),
      ccSelf: toBoolean(body.ccSelf)
    });

    return NextResponse.json({ settings, message: "Ayarlar kaydedildi." });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ message: error.message }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Ayarlar kaydedilemedi.";
    return NextResponse.json({ message }, { status: 400 });
  }
}

// Tanımsız alanlar "değiştirme" anlamına gelir; mevcut değer korunur.
function toBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toStringOrUndefined(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
