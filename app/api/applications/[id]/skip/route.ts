import { NextResponse } from "next/server";

import { requireSessionUser, UnauthorizedError } from "@/lib/auth/session";
import { skipApplication } from "@/lib/apply/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireSessionUser();
    const applicationId = Number.parseInt(params.id, 10);

    if (!Number.isFinite(applicationId)) {
      return NextResponse.json({ message: "Geçersiz başvuru numarası." }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as { reason?: string } | null;
    await skipApplication(applicationId, user.id, body?.reason);

    return NextResponse.json({ ok: true, message: "Başvuru atlandı." });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ message: error.message }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Başvuru atlanamadı.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
