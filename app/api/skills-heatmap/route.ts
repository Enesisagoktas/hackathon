import { NextResponse } from "next/server";

import { requireSessionUser, UnauthorizedError } from "@/lib/auth/session";
import mysql from "mysql2/promise";

import { getDbPool } from "@/lib/db";
import { getPrimaryCv } from "@/lib/cv/store";
import { buildSkillHeatmap, heatmapHasConfidence } from "@/lib/jobs/skill-heatmap";
import type { CandidateProfile } from "@/lib/jobs/types";

export const dynamic = "force-dynamic";

/**
 * Feature #5 — Beceri piyasa ısı haritası.
 *
 * Kullanıcının ana CV'sindeki AI profili + hedef pozisyondan, cache'teki
 * gerçek ilanların en çok istediği becerileri çıkarır. AI çağrısı yapmaz.
 */
export async function GET(request: Request) {
  try {
    const user = await requireSessionUser();
    const cv = await getPrimaryCv(user.id);

    // CV kaydında profil yoksa son tamamlanan aramanın analizi kullanılır —
    // profil orayı her koşulda yazılıyor (upload akışının ana çıktısı).
    let aiProfileRaw: unknown = cv?.aiProfile ?? null;
    let selectedPositions: string[] = [];

    if (!aiProfileRaw) {
      const pool = getDbPool();
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT ai_profile, selected_positions FROM job_searches
         WHERE user_id = ? AND ai_profile IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
        [user.id]
      );
      const selRaw = rows[0]?.selected_positions;
      const selected = Array.isArray(selRaw) ? selRaw : typeof selRaw === "string" ? JSON.parse(selRaw) : [];
      if (Array.isArray(selected) && selected.length) {
        selectedPositions = selected.map((item) => String(item));
      }
      const raw = rows[0]?.ai_profile;
      aiProfileRaw = typeof raw === "string" ? JSON.parse(raw) : raw ?? null;
      // Analiz çıktısı {aiProfile: {...}} sarmalıyla saklanabiliyor.
      if (aiProfileRaw && typeof aiProfileRaw === "object" && "aiProfile" in (aiProfileRaw as object)) {
        const inner = (aiProfileRaw as { aiProfile?: unknown; skills?: unknown }).aiProfile;
        if (inner && !(aiProfileRaw as { skills?: unknown }).skills) {
          aiProfileRaw = inner;
        }
      }
    }

    if (!aiProfileRaw) {
      return NextResponse.json(
        { message: "Isı haritası için önce CV yükleyip analiz ettirmen gerekiyor." },
        { status: 404 }
      );
    }

    const ai = aiProfileRaw as {
      skills?: string[];
      targetPositions?: string[];
      searchKeywords?: string[];
      queryVariations?: string[];
      industries?: string[];
    };

    const url = new URL(request.url);
    const roleParam = url.searchParams.get("rol")?.trim();
    const targetRole = roleParam || selectedPositions[0] || ai.targetPositions?.[0] || "Genel";

    const profile = {
      targetRole,
      titles: [targetRole, ...selectedPositions, ...(ai.targetPositions ?? [])].slice(0, 5),
      skills: (ai.skills ?? []).slice(0, 12),
      languages: [],
      industries: ai.industries ?? [],
      experienceAreas: [],
      keywords: (ai.searchKeywords ?? []).slice(0, 12),
      queryVariations: ai.queryVariations ?? [],
      locations: [],
      locationMode: "all-turkey",
      workMode: "any"
    } as CandidateProfile;

    const heatmap = await buildSkillHeatmap(profile, ai.skills ?? []);

    return NextResponse.json({ heatmap, confident: heatmapHasConfidence(heatmap) });
  } catch (error) {
    // Tip kontrolü, mesaj metni değil: UnauthorizedError'ın varsayılan mesajı
    // ("Bu işlem için giriş yapmanız gerekiyor.") ne "oturum" ne "session"
    // içerdiği için eski metin eşlemesi tutmuyor ve oturumsuz istek 401 yerine
    // 500 dönüyordu — ısı haritası kartı da bunu "veri yok" sanıyordu.
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ message: error.message }, { status: 401 });
    }
    console.error("[skills-heatmap] üretilemedi:", error);
    return NextResponse.json({ message: "Isı haritası şu an üretilemedi." }, { status: 500 });
  }
}
