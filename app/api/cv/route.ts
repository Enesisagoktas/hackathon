import { NextResponse } from "next/server";

import { requireSessionUser, UnauthorizedError } from "@/lib/auth/session";
import { deleteUserCvs, getPrimaryCv } from "@/lib/cv/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const cv = await getPrimaryCv(user.id);

    if (!cv) {
      return NextResponse.json({ cv: null });
    }

    return NextResponse.json({
      cv: {
        id: cv.id,
        fileName: cv.fileName,
        fileType: cv.fileType,
        updatedAt: cv.updatedAt,
        structuredCv: cv.structuredCv ?? null,
        // Ham metnin tamamı değil, sadece kısa bir önizleme döner.
        textPreview: cv.rawText.slice(0, 600)
      }
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ message: error.message }, { status: 401 });
    }

    return NextResponse.json({ message: "CV okunamadı." }, { status: 500 });
  }
}

/** KVKK "unutulma hakkı": saklanan CV metnini ve türevlerini siler. */
export async function DELETE() {
  try {
    const user = await requireSessionUser();
    const deleted = await deleteUserCvs(user.id);

    return NextResponse.json({
      ok: true,
      deleted,
      message: deleted ? "Saklanan CV verisi silindi." : "Silinecek CV verisi bulunamadı."
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ message: error.message }, { status: 401 });
    }

    return NextResponse.json({ message: "CV silinemedi." }, { status: 500 });
  }
}
