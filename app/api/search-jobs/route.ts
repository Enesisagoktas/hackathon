import { NextResponse } from "next/server";

import { searchJobListings } from "@/lib/job-search";
import { normalizeCities, normalizeLocationMode, normalizeWorkMode } from "@/lib/search-preferences";
import type { AiCvProfile } from "@/lib/jobs/types";

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
    const languages = toStringArray(body.languages);
    const experienceAreas = toStringArray(body.experienceAreas);
    const searchKeywords = toStringArray(body.searchKeywords);
    const industries = toStringArray(body.industries);
    const location = typeof body.location === "string" ? body.location : undefined;
    const locationMode = normalizeLocationMode(body.locationMode);
    const cities = normalizeCities(body.cities);
    const workMode = normalizeWorkMode(body.workMode);
    const userEmail = typeof body.userEmail === "string" ? body.userEmail : undefined;
    const fullText = typeof body.fullText === "string" ? body.fullText : undefined;
    const aiProfile = isAiProfile(body.aiProfile) ? body.aiProfile : undefined;

    if (!skills.length && !titles.length && !searchKeywords.length && !industries.length) {
      return errorResponse("İş araması için en az bir beceri veya pozisyon gerekli.", 400);
    }

    const payload = await searchJobListings({
      skills,
      titles,
      languages,
      experienceAreas,
      searchKeywords,
      industries,
      location,
      locationMode,
      cities,
      workMode,
      userEmail,
      fullText,
      aiProfile
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Job search failed", error);
    return errorResponse("İş arama sonuçları oluşturulurken beklenmeyen bir hata oluştu.", 500);
  }
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function isAiProfile(value: unknown): value is AiCvProfile {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}
