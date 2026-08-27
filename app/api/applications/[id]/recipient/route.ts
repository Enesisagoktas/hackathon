import { NextResponse } from "next/server";

import { requireSessionUser, UnauthorizedError } from "@/lib/auth/session";
import { isValidEmail } from "@/lib/apply/channel";
import { getApplication, setApplicationRecipient } from "@/lib/apply/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bu adreslere başvuru gönderilmesi anlamsızdır; kullanıcı yanlışlıkla girmişse uyar. */
const BLOCKED_DOMAINS = ["kariyer.net", "secretcv.com", "eleman.net", "yenibiris.com", "toptalent.co", "linkedin.com"];

/**
 * Portal-only bir ilana kullanıcının bildiği İK adresini ekler.
 *
 * Türk ilan siteleri işveren e-postasını yayınlamadığı için başvuruların
 * neredeyse tamamı "portal" kanalında kalıyor. Kullanıcı şirketin adresini
 * biliyorsa buradan girer ve paketi e-posta ile gönderebilir hale getirir.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireSessionUser();
    const applicationId = Number.parseInt(params.id, 10);

    if (!Number.isFinite(applicationId)) {
      return NextResponse.json({ message: "Geçersiz başvuru numarası." }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLocaleLowerCase("tr-TR") : "";

    if (!isValidEmail(email)) {
      return NextResponse.json({ message: "Geçerli bir e-posta adresi gir." }, { status: 400 });
    }

    const domain = email.split("@")[1] ?? "";
    if (BLOCKED_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))) {
      return NextResponse.json(
        { message: "Bu adres ilan sitesine ait; işverenin kendi e-posta adresini gir." },
        { status: 400 }
      );
    }

    // Sahiplik: setApplicationRecipient user_id ile filtreliyor, ama önce
    // varlık kontrolü yaparak net bir 404 döndürelim.
    const application = await getApplication(applicationId, user.id);
    if (!application) {
      return NextResponse.json({ message: "Başvuru bulunamadı." }, { status: 404 });
    }

    if (application.status === "sent") {
      return NextResponse.json({ message: "Bu başvuru zaten gönderildi." }, { status: 409 });
    }

    await setApplicationRecipient(applicationId, user.id, email);

    return NextResponse.json({
      ok: true,
      email,
      message: "Adres kaydedildi. Artık bu başvuruyu gönderebilirsin."
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ message: error.message }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Adres kaydedilemedi.";
    console.error("Set recipient failed", error);
    return NextResponse.json({ message }, { status: 400 });
  }
}
