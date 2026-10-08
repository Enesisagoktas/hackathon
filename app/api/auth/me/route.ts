import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth/session";
import { getPrimaryCv } from "@/lib/cv/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sayfa açılışında oturumu ve kayıtlı ana CV'yi bildirir. */
export async function GET() {
  try {
    const user = await getSessionUser();

    if (!user) {
      return NextResponse.json({ user: null });
    }

    const cv = await getPrimaryCv(user.id);

    return NextResponse.json({
      user: { id: user.id, fullName: user.fullName, email: user.email },
      // Ham CV metni istemciye gönderilmez; sadece varlığı bildirilir.
      cv: cv ? { id: cv.id, fileName: cv.fileName, fileType: cv.fileType, updatedAt: cv.updatedAt } : null
    });
  } catch (error) {
    console.error("Session lookup failed", error);
    return NextResponse.json({ user: null });
  }
}
