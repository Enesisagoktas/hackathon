import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { closeDbPool, getDbPool } from "../lib/db";
import { buildCandidateEligibility, evaluateEligibility, BAND_LABELS } from "../lib/jobs/eligibility";
import { extractRoleRequirements } from "../lib/jobs/requirement-parser";
import type { CandidateProfile } from "../lib/jobs/types";
import type mysql from "mysql2/promise";

/**
 * Uygunluk motorunun AŞIRI ELEME yapıp yapmadığını gerçek veriyle ölçer.
 *
 * Tek bir testin geçmesi motorun sahada doğru davrandığını göstermez: eşikler
 * fazla katıysa sistem sessizce boş sonuç döndürür. Bu denetim, veritabanındaki
 * bütün aktif ilanları üç farklı aday profiline karşı değerlendirip eleme
 * oranını ve gerekçe dağılımını raporlar.
 */

const asArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [value];
    } catch {
      return [value];
    }
  }
  return [];
};

const PROFILES: Array<{ name: string; profile: CandidateProfile }> = [
  {
    name: "Öğrenci / stajyer (Java)",
    profile: {
      targetRole: "Backend Developer",
      titles: ["Java Developer"],
      skills: ["Java", "Spring Boot", "SQL", "Git"],
      languages: ["İngilizce"],
      industries: ["Yazılım"],
      experienceAreas: ["Backend"],
      keywords: ["java", "backend"],
      locations: [],
      locationMode: "all-turkey",
      workMode: "any",
      seniority: "stajyer",
      yearsOfExperience: 0,
      educationLevel: "Üniversite (Öğrenci)",
      desiredSeniority: "stajyer"
    } as CandidateProfile
  },
  {
    name: "Kıdemli yazılımcı (5 yıl)",
    profile: {
      targetRole: "Frontend Developer",
      titles: ["Frontend Developer"],
      skills: ["React", "Next.js", "TypeScript", "JavaScript"],
      languages: ["İngilizce"],
      industries: ["Yazılım"],
      experienceAreas: ["Web geliştirme"],
      keywords: ["react", "frontend"],
      locations: [],
      locationMode: "all-turkey",
      workMode: "any",
      seniority: "senior",
      yearsOfExperience: 5,
      educationLevel: "Üniversite (Mezun)",
      desiredSeniority: "any"
    } as CandidateProfile
  },
  {
    name: "Hemşire (3 yıl)",
    profile: {
      targetRole: "Hemşire",
      titles: ["Hemşire", "Servis Hemşiresi"],
      skills: ["Hasta bakımı", "Yoğun bakım", "İlaç uygulama"],
      languages: [],
      industries: ["Sağlık"],
      experienceAreas: ["Klinik"],
      keywords: ["hemşire", "hasta"],
      locations: [],
      locationMode: "all-turkey",
      workMode: "any",
      seniority: "orta",
      yearsOfExperience: 3,
      educationLevel: "Üniversite (Mezun)",
      desiredSeniority: "any"
    } as CandidateProfile
  }
];

async function main() {
  const pool = getDbPool();
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT title, company, location, work_mode, description, requirements, candidate_criteria
     FROM job_listings WHERE status = 'active'`
  );

  console.log(`\n═══ Uygunluk denetimi — ${rows.length} aktif ilan ═══\n`);

  for (const { name, profile } of PROFILES) {
    const candidate = buildCandidateEligibility(profile);
    const reasons = new Map<string, number>();
    const bands = new Map<string, number>();
    let eligible = 0;

    for (const row of rows) {
      const role = extractRoleRequirements({
        title: String(row.title ?? ""),
        description: String(row.description ?? ""),
        requirements: asArray(row.requirements),
        candidateCriteria: asArray(row.candidate_criteria),
        location: row.location ? String(row.location) : undefined,
        workMode: row.work_mode ?? undefined
      });

      const result = evaluateEligibility(role, candidate, { listingVerified: true });

      if (result.eligible) {
        eligible += 1;
        bands.set(BAND_LABELS[result.band], (bands.get(BAND_LABELS[result.band]) ?? 0) + 1);
      } else {
        for (const blocker of result.blockers) {
          reasons.set(blocker.label, (reasons.get(blocker.label) ?? 0) + 1);
        }
      }
    }

    const rate = Math.round((eligible / rows.length) * 100);
    console.log(`── ${name}`);
    console.log(`   Hard filter'ı geçen: ${eligible}/${rows.length} (%${rate})`);

    if (reasons.size) {
      const sorted = Array.from(reasons.entries()).sort((a, b) => b[1] - a[1]);
      console.log(`   Eleme gerekçeleri: ${sorted.map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }

    if (bands.size) {
      const sorted = Array.from(bands.entries()).sort((a, b) => b[1] - a[1]);
      console.log(`   Geçenlerin bantları: ${sorted.map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }

    // AŞIRI ELEME UYARISI: hiçbir profil için oran %10'un altına düşmemeli.
    if (rate < 10) {
      console.log(`   ⚠️  UYARI: eleme oranı çok yüksek, eşikler fazla katı olabilir.`);
    }
    console.log("");
  }
}

main()
  .catch((error) => {
    console.error("Denetim çöktü:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDbPool().catch(() => undefined));
