import {
  BAND_LABELS,
  buildCandidateEligibility,
  compareByPriority,
  evaluateEligibility,
  findHardBlockers,
  scoreBand,
  type CandidateEligibility
} from "../lib/jobs/eligibility";
import { extractRoleRequirements } from "../lib/jobs/requirement-parser";
import type { CandidateProfile } from "../lib/jobs/types";

/**
 * Sistemin engellemesi istenen temel hata:
 * "CV teknik olarak %80–95 uyumlu ama aday aslında ilanın aradığı kişi değil."
 */

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

// ── Aday: öğrenci, stajyer, 0 yıl deneyim, Java/Spring biliyor ────────────
const studentProfile = {
  targetRole: "Backend Developer",
  titles: ["Java Developer", "Backend Developer"],
  skills: ["Java", "Spring Boot", "SQL", "Git"],
  languages: ["İngilizce"],
  industries: ["Yazılım"],
  experienceAreas: ["Backend geliştirme"],
  keywords: ["java", "spring", "backend"],
  locations: ["Ankara"],
  locationMode: "cities",
  workMode: "any",
  seniority: "stajyer",
  yearsOfExperience: 0,
  educationLevel: "Üniversite (Öğrenci)",
  desiredSeniority: "stajyer"
} as CandidateProfile;

const student = buildCandidateEligibility(studentProfile);

console.log("\n═══ Katmanlı aday uygunluğu ═══\n");

console.log("1) Aday profili doğru okunuyor");
check("Öğrenci olduğu anlaşıldı", student.isStudent === true);
check("Deneyim yılı okundu", student.yearsOfExperience === 0);
check("Kıdem stajyer", student.seniority === "stajyer");
check("Eğitim seviyesi üniversite", student.educationLevel === "universite");
check("Staj aradığı anlaşıldı", student.desiredEmployment === "staj");

console.log("\n2) ŞARTNAMEDEKİ ANA SENARYO — teknik %95, ama aday uygun değil");
// İlan: mezun + full-time + 2 yıl deneyim zorunlu. Teknoloji birebir aynı.
const seniorJavaListing = extractRoleRequirements({
  title: "Java Backend Developer",
  description:
    "Tam zamanlı çalışacak, Java ve Spring Boot ile mikroservis geliştirecek takım arkadaşı arıyoruz. SQL ve Git kullanımı zorunludur.",
  requirements: [
    "Java ve Spring Boot ile en az 2 yıl deneyim zorunludur.",
    "SQL sorguları yazabilmek gereklidir.",
    "Git kullanımı zorunludur."
  ],
  candidateCriteria: [
    "Tecrübe En az 2 yıl tecrübeli",
    "Eğitim Seviyesi Üniversite(Mezun)"
  ],
  location: "Ankara"
});

const seniorResult = evaluateEligibility(seniorJavaListing, student, { listingVerified: true });

check("Teknik uyum yüksek çıkıyor", seniorResult.technicalScore >= 25, `teknik ${seniorResult.technicalScore}/40`);
check("YİNE DE ELENDİ", seniorResult.eligible === false);
check(
  "Mezuniyet şartı blocker olarak gösterildi",
  seniorResult.blockers.some((b) => b.code === "graduate-required"),
  seniorResult.blockers.map((b) => b.label).join(" + ")
);
check(
  "Deneyim şartı blocker olarak gösterildi",
  seniorResult.blockers.some((b) => b.code === "experience-below-min")
);
check(
  "Kullanıcıya sebep açıklanıyor",
  seniorResult.blockers.every((b) => b.detail.length > 20),
  seniorResult.blockers[0]?.detail
);

console.log("\n3) Aynı adaya UYGUN olan staj ilanı geçmeli");
const internListing = extractRoleRequirements({
  title: "Yazılım Stajyeri (Backend)",
  description: "Java ve Spring Boot öğrenmek isteyen üniversite öğrencisi arıyoruz. Ankara ofisimizde.",
  requirements: ["Java temel bilgisi gereklidir.", "SQL bilmesi tercih sebebidir."],
  candidateCriteria: ["Tecrübe Tecrübesiz", "Eğitim Seviyesi Üniversite(Öğrenci), Üniversite(Mezun)"],
  location: "Ankara"
});

const internResult = evaluateEligibility(internListing, student, { listingVerified: true });
check("Staj ilanı hard filter'ı geçti", internResult.eligible === true, internResult.blockers.map((b) => b.label).join(", ") || "blocker yok");
check("Pozisyon uygunluğu yüksek", internResult.roleScore >= 45, `pozisyon ${internResult.roleScore}/60`);
check("Toplam skor uygun bandında", internResult.totalScore >= 70, `${internResult.totalScore} → ${BAND_LABELS[internResult.band]}`);

console.log("\n4) Uygun staj ilanı, uygun olmayan senior ilanının ÖNÜNE geçiyor");
const ordered = [
  { eligibility: seniorResult, postedAt: "2026-08-27" },
  { eligibility: internResult, postedAt: "2026-08-01" }
].sort(compareByPriority);
check("Sıralamada uygun ilan başta", ordered[0].eligibility.eligible === true);

console.log("\n5) Hard filter tek tek");
const noBlockers = findHardBlockers(internListing, student);
check("Uygun ilanda blocker yok", noBlockers.length === 0);

const remoteSenior = extractRoleRequirements({
  title: "Senior Backend Developer",
  description: "Remote çalışacak kıdemli geliştirici.",
  candidateCriteria: ["Tecrübe En az 5 yıl tecrübeli", "Eğitim Seviyesi Üniversite(Mezun)"],
  location: "İstanbul"
});
const seniorBlockers = findHardBlockers(remoteSenior, student);
check("Kıdem uyumsuzluğu yakalanır", seniorBlockers.some((b) => b.code === "seniority-mismatch"));
check("Konum uyumsuzluğu yakalanır", seniorBlockers.some((b) => b.code === "location-mismatch"), "İstanbul ≠ Ankara");

console.log("\n6) TEMKİN İLKESİ — bilinmeyen şart eleme sebebi değil");
const vagueListing = extractRoleRequirements({
  title: "Yazılım Geliştirici",
  description: "Ekibimize katılacak yazılım geliştirici arıyoruz. Java ve SQL kullanıyoruz."
});
const vagueResult = evaluateEligibility(vagueListing, student, { listingVerified: true });
check("Şartı okunamayan ilan elenmez", vagueResult.eligible === true, vagueResult.blockers.map((b) => b.label).join(", ") || "blocker yok");
check("Düşük güven raporlanır", vagueResult.requirementConfidence === "low", vagueResult.requirementConfidence);

const unknownYears = buildCandidateEligibility({ ...studentProfile, yearsOfExperience: undefined } as CandidateProfile);
const unknownResult = evaluateEligibility(seniorJavaListing, unknownYears, { listingVerified: true });
check(
  "Deneyim yılı bilinmiyorsa deneyimden elenmez",
  !unknownResult.blockers.some((b) => b.code === "experience-below-min"),
  unknownResult.blockers.map((b) => b.code).join(", ")
);

console.log("\n7) Katman 0 — doğrulanmamış ilan her koşulda elenir");
const unverified = evaluateEligibility(internListing, student, { listingVerified: false });
check("Doğrulanmamış ilan elendi", unverified.eligible === false);
check("Sebep 'ilan doğrulanamadı'", unverified.blockers[0]?.code === "listing-invalid");

console.log("\n8) Deneyimli aday senaryosu");
const seniorCandidate = buildCandidateEligibility({
  ...studentProfile,
  seniority: "senior",
  yearsOfExperience: 6,
  educationLevel: "Üniversite (Mezun)",
  desiredSeniority: "any",
  locations: ["Ankara"]
} as CandidateProfile);

check("Mezun olduğu anlaşıldı", seniorCandidate.isStudent === false);
const seniorFit = evaluateEligibility(seniorJavaListing, seniorCandidate, { listingVerified: true });
check("Kıdemli aday senior ilana uygun", seniorFit.eligible === true, seniorFit.blockers.map((b) => b.label).join(", ") || "blocker yok");
check("Skoru yüksek", seniorFit.totalScore >= 75, `${seniorFit.totalScore} → ${BAND_LABELS[seniorFit.band]}`);

console.log("\n9) Skor bantları (§14)");
check("90+ çok güçlü", scoreBand(95) === "cok-guclu");
check("80-89 çok uygun", scoreBand(84) === "cok-uygun");
check("70-79 uygun", scoreBand(72) === "uygun");
check("60-69 sınırda", scoreBand(65) === "sinirda");
check("60 altı uygun değil", scoreBand(41) === "uygun-degil");

console.log("\n10) Pozisyon ve teknik skor ayrı tutuluyor");
check("Pozisyon skoru 60 tavanlı", internResult.roleScore <= 60);
check("Teknik skor 40 tavanlı", internResult.technicalScore <= 40);
check(
  "Bileşenler kullanıcıya gösterilebilir",
  internResult.roleComponents.length === 5 && internResult.technicalComponents.length === 4,
  `${internResult.roleComponents.length} pozisyon + ${internResult.technicalComponents.length} teknik bileşen`
);
check(
  "Her bileşende açıklama var",
  [...internResult.roleComponents, ...internResult.technicalComponents].every((c) => c.detail.length > 5)
);

console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
if (failed > 0) process.exitCode = 1;
