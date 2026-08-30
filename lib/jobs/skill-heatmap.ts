import { extractKnownSkills } from "@/lib/cv/skill-dictionary";
import { normalizeComparable } from "@/lib/jobs/normalize";
import { searchActiveListings } from "@/lib/jobs/repository";
import type { CandidateProfile } from "@/lib/jobs/types";

/**
 * Beceri piyasa ısı haritası (Feature #5).
 *
 * "Hedef mesleğim için piyasa en çok neyi istiyor, bende hangileri var?"
 * sorusunu SADECE cache'teki gerçek ilan verisiyle cevaplar — AI çağrısı yok,
 * uydurma yok. Beceri adları mevcut SKILL_DICTIONARY ile normalize edilir;
 * böylece "ReactJS" ile "React" aynı sayaçta toplanır.
 *
 * DİL KURALI (şartname): CV'de bulunmayan beceri "bilmiyorsun" DEĞİL,
 * "CV'nde tespit edilmedi" demektir. Arayüz metni bu ayrımı korur.
 */

export type HeatmapStatus = "present" | "missing" | "partial";

export type HeatmapSkill = {
  skill: string;
  /** Kaç ilanda geçtiği. */
  count: number;
  /** İncelenen ilanlara oranı (0-1). */
  share: number;
  status: HeatmapStatus;
};

export type SkillHeatmap = {
  targetRole: string;
  /** İncelenen ilan sayısı — güven göstergesi; azsa arayüz not düşer. */
  sampleSize: number;
  skills: HeatmapSkill[];
};

const TOP_SKILLS = 20;
const MIN_SAMPLE_FOR_CONFIDENCE = 5;

/** CV becerisi ile piyasa becerisi "kısmen" eşleşiyor mu? (ör. "React" ↔ "React Native") */
function partialMatch(cvSkills: string[], marketSkill: string): boolean {
  return cvSkills.some(
    (skill) =>
      skill !== marketSkill &&
      skill.length >= 4 &&
      marketSkill.length >= 4 &&
      (skill.includes(marketSkill) || marketSkill.includes(skill))
  );
}

/**
 * Hedef meslek için piyasa becerilerini çıkarır ve CV ile karşılaştırır.
 *
 * Tek DB taraması (mevcut searchActiveListings), sonrası saf hesap.
 */
export async function buildSkillHeatmap(
  profile: CandidateProfile,
  cvSkills: string[]
): Promise<SkillHeatmap> {
  const listings = await searchActiveListings(profile);

  const counts = new Map<string, number>();

  for (const listing of listings) {
    const text = [
      listing.title,
      listing.description ?? "",
      ...(Array.isArray(listing.requirements) ? listing.requirements : []),
      ...(Array.isArray(listing.candidateCriteria) ? listing.candidateCriteria : [])
    ].join("\n");

    // Aynı ilanda bir beceri kaç kez geçerse geçsin 1 sayılır: sayaç
    // "kaç ilan istiyor"u ölçer, metin uzunluğunu değil.
    //
    // BELİRTEÇ TABANLI DOĞRULAMA: extractKnownSkills kısa adlarda alt-dize
    // yakalayabiliyor — canlı ölçümde "go" 121 ilanda göründü ("kategori"
    // içindeki g-o!), "dart" 24 ilanda ("standart"). Tek kelimelik beceri
    // ancak metinde BAĞIMSIZ BİR KELİME olarak geçiyorsa sayılır.
    const normalizedText = normalizeComparable(text);
    const tokens = new Set(normalizedText.split(" "));
    const skills = new Set(
      extractKnownSkills(text)
        .map((skill) => normalizeComparable(skill))
        .filter((skill) => {
          if (skill.includes(" ")) {
            return normalizedText.includes(skill);
          }
          return tokens.has(skill);
        })
    );

    for (const skill of Array.from(skills)) {
      counts.set(skill, (counts.get(skill) ?? 0) + 1);
    }
  }

  const normalizedCvSkills = cvSkills.map((skill) => normalizeComparable(skill)).filter(Boolean);
  const cvSkillSet = new Set(normalizedCvSkills);

  const skills: HeatmapSkill[] = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, TOP_SKILLS)
    .map(([skill, count]) => ({
      skill,
      count,
      share: listings.length ? count / listings.length : 0,
      status: cvSkillSet.has(skill)
        ? ("present" as const)
        : partialMatch(normalizedCvSkills, skill)
          ? ("partial" as const)
          : ("missing" as const)
    }));

  return {
    targetRole: profile.targetRole,
    sampleSize: listings.length,
    skills
  };
}

export function heatmapHasConfidence(heatmap: SkillHeatmap): boolean {
  return heatmap.sampleSize >= MIN_SAMPLE_FOR_CONFIDENCE;
}
