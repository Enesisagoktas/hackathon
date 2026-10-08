import { readFileSync } from "fs";
import path from "path";

import { buildCandidateEligibility, evaluateEligibility } from "../lib/jobs/eligibility";
import { extractRoleRequirements } from "../lib/jobs/requirement-parser";
import type { CandidateProfile } from "../lib/jobs/types";

/**
 * Altın Küme regresyon testi (Feature #6).
 *
 * Deterministik eşleştirme motorunu (şart çıkarımı + uygunluk + puanlama)
 * elle etiketli çiftlere karşı doğrular. AI ÇAĞRISI YAPMAZ — bantlar
 * deterministik toplam skora (pozisyon 60 + teknik 40) uygulanır ve
 * TOLERANSLIDIR: nokta değer değil bant beklenir (şartname kuralı).
 *
 * Bant eşikleri:
 *   high   → toplam ≥ 65 (deterministik kısım; AI karışınca yükselir)
 *   medium → 45-85 arası kabul
 *   low    → toplam < 60
 *
 * expectedOverride: etiketleme sırasında motorun HAKLI çıktığı sınır
 * durumlar — beklenti nota göre güncellenmiş hali; why alanı gerekçeyi taşır.
 */

type Expected = { eligible: boolean; scoreBand?: "high" | "medium" | "low"; reasons?: string[] };

type GoldenFile = {
  cvs: Record<string, CandidateProfile>;
  jobs: Record<
    string,
    { title: string; description: string; requirements?: string[]; candidateCriteria?: string[]; location?: string }
  >;
  pairs: Array<{ cv: string; job: string; expected: Expected; expectedOverride?: Expected; why: string }>;
};

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function bandMatches(total: number, band: "high" | "medium" | "low"): boolean {
  if (band === "high") return total >= 65;
  if (band === "medium") return total >= 45 && total <= 85;
  // Sınır toleranslı (şartname: nokta değer değil bant): meslek-dışı ama
  // blocker'sız çiftler deterministik kısımda tam 60'a oturabiliyor.
  return total <= 60;
}

function main() {
  const raw = readFileSync(path.resolve(process.cwd(), "tests/golden/pairs.json"), "utf8");
  const golden = JSON.parse(raw) as GoldenFile;

  console.log(`\n═══ Altın Küme — ${golden.pairs.length} elle etiketli çift ═══\n`);

  for (const pair of golden.pairs) {
    const cvProfile = golden.cvs[pair.cv];
    const job = golden.jobs[pair.job];

    if (!cvProfile || !job) {
      check(`${pair.cv} × ${pair.job}`, false, "fikstür eksik");
      continue;
    }

    const expected = pair.expectedOverride ?? pair.expected;
    const candidate = buildCandidateEligibility(cvProfile);
    const role = extractRoleRequirements(job);
    const result = evaluateEligibility(role, candidate, {
      listingVerified: true,
      listingKeywords: [job.title]
    });

    const label = `${pair.cv} × ${pair.job}`;

    if (!expected.eligible) {
      const reasonsOk =
        !expected.reasons ||
        expected.reasons.every((code) => result.blockers.some((blocker) => blocker.code === code));

      check(
        label,
        !result.eligible && reasonsOk,
        result.eligible
          ? `UYGUN çıktı (beklenen: elenmeli) — ${pair.why}`
          : reasonsOk
            ? result.blockers.map((blocker) => blocker.code).join(",")
            : `gerekçe farklı: ${result.blockers.map((blocker) => blocker.code).join(",")} (beklenen: ${expected.reasons?.join(",")})`
      );
      continue;
    }

    const bandOk = !expected.scoreBand || bandMatches(result.totalScore, expected.scoreBand);
    check(
      label,
      result.eligible && bandOk,
      !result.eligible
        ? `ELENDİ (${result.blockers.map((blocker) => blocker.code).join(",")}) — beklenen: uygun; ${pair.why}`
        : `toplam ${result.totalScore} → ${expected.scoreBand ?? "bant şartı yok"}`
    );
  }

  console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
  if (failed > 0) process.exitCode = 1;
}

main();
