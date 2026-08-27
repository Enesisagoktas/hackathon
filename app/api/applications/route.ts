import { NextResponse } from "next/server";

import { requireSessionUser, UnauthorizedError } from "@/lib/auth/session";
import { getApplicationStats, listApplications, type ApplicationStatus } from "@/lib/apply/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES: ApplicationStatus[] = [
  "preparing", "needs_review", "queued", "sent", "manual_required", "skipped", "failed"
];

/** Oturumdaki kullanıcının başvuru listesi ve durum sayaçları. */
export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const status = VALID_STATUSES.find((item) => item === statusParam);

    const [applications, stats] = await Promise.all([
      listApplications(user.id, { status, limit: Number(url.searchParams.get("limit") ?? 100) }),
      getApplicationStats(user.id)
    ]);

    return NextResponse.json({ applications, stats });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ message: error.message }, { status: 401 });
    }

    console.error("List applications failed", error);
    return NextResponse.json({ message: "Başvurular okunurken hata oluştu." }, { status: 500 });
  }
}
