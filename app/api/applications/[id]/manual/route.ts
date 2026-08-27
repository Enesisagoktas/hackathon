import { NextResponse } from "next/server";

import { requireSessionUser, UnauthorizedError } from "@/lib/auth/session";
import { markManuallyApplied } from "@/lib/apply/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Portal ilanlarında kullanıcı "ilan sayfasından başvurdum" dediğinde. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireSessionUser();
    const applicationId = Number.parseInt(params.id, 10);

    if (!Number.isFinite(applicationId)) {
      return NextResponse.json({ message: "Geçersiz başvuru numarası." }, { status: 400 });
    }

    await markManuallyApplied(applicationId, user.id);

    return NextResponse.json({ ok: true, message: "Başvuru tamamlandı olarak işaretlendi." });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ message: error.message }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "İşaretleme başarısız.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
