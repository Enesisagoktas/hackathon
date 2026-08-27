import { NextResponse } from "next/server";

import { requireSessionUser, UnauthorizedError } from "@/lib/auth/session";
import { sendPreparedApplication } from "@/lib/apply/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hazırlanmış başvuruyu kullanıcının açık onayıyla gönderir.
 * `autoApplied: false` — bu gönderim kullanıcının tuşa basmasıyla oldu.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireSessionUser();
    const applicationId = Number.parseInt(params.id, 10);

    if (!Number.isFinite(applicationId)) {
      return NextResponse.json({ message: "Geçersiz başvuru numarası." }, { status: 400 });
    }

    const application = await sendPreparedApplication(applicationId, user.id, { autoApplied: false });

    return NextResponse.json({ application, message: "Başvuru gönderildi." });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ message: error.message }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Başvuru gönderilemedi.";
    console.error("Send application failed", error);
    return NextResponse.json({ message }, { status: 400 });
  }
}
