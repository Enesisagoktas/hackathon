import { NextResponse } from "next/server";

import { generateJobLinks } from "@/lib/generate-links";
import { normalizeCities, normalizeLocationMode, normalizeWorkMode } from "@/lib/search-preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return errorResponse("Geçerli bir istek gövdesi gönderin.", 400);
    }

    const skills = toStringArray(body.skills);
    const titles = toStringArray(body.titles);
    const location = typeof body.location === "string" ? body.location : undefined;
    const locationMode = normalizeLocationMode(body.locationMode);
    const cities = normalizeCities(body.cities);
    const workMode = normalizeWorkMode(body.workMode);

    if (!skills.length && !titles.length) {
      return errorResponse("Link üretmek için en az bir beceri veya pozisyon gerekli.", 400);
    }

    const links = generateJobLinks({ skills, titles, location, locationMode, cities, workMode });

    return NextResponse.json({ links });
  } catch (error) {
    console.error("Job link generation failed", error);
    return errorResponse("İş arama linkleri oluşturulurken beklenmeyen bir hata oluştu.", 500);
  }
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}
