import { NextResponse } from "next/server";

import { requireSessionUser, UnauthorizedError } from "@/lib/auth/session";
import { getApplication, listApplicationEvents } from "@/lib/apply/repository";
import { renderTailoredCvHtml } from "@/lib/cv/render-html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tek başvurunun tüm detayı: uyarlanmış CV, ön yazı, eksik raporu, denetim izi. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireSessionUser();
    const applicationId = Number.parseInt(params.id, 10);

    if (!Number.isFinite(applicationId)) {
      return NextResponse.json({ message: "Geçersiz başvuru numarası." }, { status: 400 });
    }

    const application = await getApplication(applicationId, user.id);

    if (!application) {
      return NextResponse.json({ message: "Başvuru bulunamadı." }, { status: 404 });
    }

    const events = await listApplicationEvents(applicationId);

    return NextResponse.json({
      application,
      events,
      // Arayüzde CV'yi olduğu gibi göstermek için hazır HTML önizleme.
      previewHtml: application.tailoredCv ? renderTailoredCvHtml(application.tailoredCv) : null
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ message: error.message }, { status: 401 });
    }

    console.error("Get application failed", error);
    return NextResponse.json({ message: "Başvuru okunurken hata oluştu." }, { status: 500 });
  }
}
