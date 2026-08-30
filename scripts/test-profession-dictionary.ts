import { expandProfessionTerms, lookupProfession, PROFESSION_DICTIONARY } from "../lib/jobs/profession-dictionary";

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

console.log("\n═══ Meslek sözlüğü (Feature #1) ═══\n");

console.log("1) Şartnamedeki örnekler — yazılım");
const backend = lookupProfession("Backend Developer");
check("Backend Developer tanınır", backend?.canonical === "backend_developer");
check("Backend Engineer aynı girişe düşer", lookupProfession("Backend Engineer")?.canonical === "backend_developer");
check(
  "Junior Backend Developer gevşek eşleşir",
  lookupProfession("Junior Backend Developer")?.canonical === "backend_developer",
  "unvan içinde alias arama"
);
check(
  "Software Engineer Backend eşdeğerdir",
  backend?.equivalent.some((alias) => alias.includes("software engineer backend")) === true
);
check(
  "Backend → Full Stack SADECE komşudur",
  backend?.related.some((alias) => alias.includes("full stack")) === true &&
    !backend?.equivalent.some((alias) => alias.includes("full stack")),
  "sınıf ayrımı korunuyor"
);
check(
  "Backend → Data Scientist eşdeğer DEĞİL",
  !backend?.equivalent.some((alias) => alias.includes("data")) &&
    !backend?.related.some((alias) => alias.includes("data scientist"))
);

console.log("\n2) Şartnamedeki örnekler — muhasebe ve servis");
check("Muhasebe Elemanı = Muhasebeci", lookupProfession("Muhasebe Elemanı")?.canonical === "muhasebeci");
check(
  "Ön Muhasebe ayrı kanoniktir (körlemesine birleştirme yok)",
  lookupProfession("Ön Muhasebe Elemanı")?.canonical === "on_muhasebe",
  "muhasebeci ile related bağı var, equivalent değil"
);
check("Garson = Servis Elemanı", lookupProfession("Servis Elemanı")?.canonical === "garson");
const garson = lookupProfession("Garson");
check(
  "Komi garsona komşudur, eşdeğer değildir",
  garson?.related.some((alias) => alias === "komi") === true &&
    !garson?.equivalent.some((alias) => alias === "komi")
);

console.log("\n3) Türkçe/İngilizce köprüsü");
check("Hemşire = Nurse", lookupProfession("Nurse")?.canonical === "hemsire");
check("Önyüz Geliştirici = Frontend Developer", lookupProfession("Önyüz Geliştirici")?.canonical === "frontend_developer");
check(
  "Arayüz Yazılım Uzmanı frontend'e düşer",
  lookupProfession("Arayüz Yazılım Uzmanı")?.canonical === "frontend_developer",
  "cache'teki gerçek ilan başlığı"
);

console.log("\n4) Genişletme — sınıf ayrımı ve girdi koruması");
const expansion = expandProfessionTerms(["Backend Developer"]);
check("Eşdeğerler üretildi", expansion.equivalents.length >= 4, `${expansion.equivalents.length} eşdeğer`);
check("Girdinin kendisi tekrarlanmaz", !expansion.equivalents.some((t) => t.toLowerCase() === "backend developer"));
check(
  "Komşular eşdeğerlere sızmaz",
  !expansion.equivalents.some((t) => /full stack/i.test(t)) && expansion.related.some((t) => /full stack/i.test(t))
);
check("Kanonik raporlanır", expansion.canonicals.includes("backend_developer"));

const unknown = expandProfessionTerms(["Uzay Madenciliği Uzmanı"]);
check("Sözlükte olmayan meslek: davranış değişmez", unknown.equivalents.length === 0 && unknown.canonicals.length === 0);

const multi = expandProfessionTerms(["Garson", "Kasiyer"]);
check("Çoklu unvan birleşik genişler", multi.canonicals.length === 2, multi.canonicals.join(","));

console.log("\n5) Sözlük bütünlüğü");
const seen = new Set<string>();
let dupCanonical = false;
for (const entry of PROFESSION_DICTIONARY) {
  if (seen.has(entry.canonical)) dupCanonical = true;
  seen.add(entry.canonical);
}
check("Kanonik adlar benzersiz", !dupCanonical, `${seen.size} meslek`);
check("En az 25 meslek kapsanıyor", PROFESSION_DICTIONARY.length >= 25, `${PROFESSION_DICTIONARY.length}`);
check(
  "Her girişte en az 2 eşdeğer var",
  PROFESSION_DICTIONARY.every((entry) => entry.equivalent.length >= 2)
);

console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
if (failed > 0) process.exitCode = 1;
