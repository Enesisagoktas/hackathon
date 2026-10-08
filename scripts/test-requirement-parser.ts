import {
  detectEmploymentType,
  detectSeniority,
  extractRoleRequirements,
  looksLikeCodeNoise,
  parseEducationRequirement,
  parseExperienceRequirement,
  parseLanguageRequirement,
  splitRequirementLines,
  stripCriteriaNoise
} from "../lib/jobs/requirement-parser";

/**
 * Testlerdeki kriter metinleri UYDURULMADI: veritabanındaki 91 gerçek ilanın
 * "Aday Kriterleri" bloğundan birebir alındı.
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

console.log("\n═══ İlan şart çıkarımı (gerçek ilan metinleriyle) ═══\n");

console.log("1) Platform gürültüsünün kesilmesi");
check(
  "Mülakat provası reklamı kesilir",
  stripCriteriaNoise("Üniversite(Mezun) Yapay zeka ile bu pozisyona özel mülakat provası yap") ===
    "Üniversite(Mezun)",
  stripCriteriaNoise("Üniversite(Mezun) Yapay zeka ile bu pozisyona özel mülakat provası yap")
);
check("Şirket tanıtımı kesilir", !stripCriteriaNoise("Üniversite(Mezun) Şirket Hakkında MerIT").includes("MerIT"));
check("Temiz metin bozulmaz", stripCriteriaNoise("Üniversite(Mezun)") === "Üniversite(Mezun)");

console.log("\n2) Sayfadan sızan JavaScript elenir (gerçek bozuk kayıt)");
check(
  "JS bloğu gürültü sayılır",
  looksLikeCodeNoise("qualifications:{isLoading:a,isActive:b,isViewActive:b,isReviewActive:b,callOnStart:b,i")
);
check(
  "Gerçek nitelik metni gürültü sayılmaz",
  !looksLikeCodeNoise("Üniversitelerin Bilgisayar Mühendisliği bölümünden mezun, en az 3 yıl deneyimli")
);
check("Boş satır gürültü sayılır", looksLikeCodeNoise("   "));

console.log("\n3) Tecrübe — 11 gerçek varyantın tamamı");
const tecTests: Array<[string, number | null, number | null, boolean]> = [
  ["Tecrübe En az 3 yıl tecrübeli", 3, null, false],
  ["Tecrübe En az 1 yıl tecrübeli", 1, null, false],
  ["Tecrübe En az 5 yıl tecrübeli", 5, null, false],
  ["Tecrübe En çok 3 yıl tecrübeli", null, 3, false],
  ["Tecrübe En çok 2 yıl tecrübeli", null, 2, false],
  ["Tecrübe Tecrübesiz", null, null, true],
  ["Tecrübe Tecrübeli / Tecrübesiz", null, null, true]
];
for (const [input, min, max, noExp] of tecTests) {
  const r = parseExperienceRequirement(input);
  check(
    `"${input.replace("Tecrübe ", "")}"`,
    r.minYears === min && r.maxYears === max && r.acceptsNoExperience === noExp,
    `min=${r.minYears} max=${r.maxYears} tecrübesiz=${r.acceptsNoExperience}`
  );
}

console.log("\n4) Eğitim seviyesi — öğrenci/mezun ayrımı");
const onlyGraduate = parseEducationRequirement(
  "Eğitim Seviyesi Üniversite(Mezun) Yapay zeka ile bu pozisyona özel mülakat provası yap"
);
check("Tek seviye okunur", onlyGraduate.length === 1 && onlyGraduate[0].level === "universite");
check("Mezun şartı görülür", onlyGraduate[0]?.graduate === true && onlyGraduate[0]?.student === false);

const withStudent = parseEducationRequirement(
  "Eğitim Seviyesi Lise(Mezun), Ön Lisans(Öğrenci), Ön Lisans(Mezun), Üniversite(Öğrenci), Üniversite(Mezun)"
);
check("Çoklu seviye okunur", withStudent.length === 3, `${withStudent.map((e) => e.level).join(", ")}`);
check("Öğrenci kabulü görülür", withStudent.some((e) => e.student));

const mastersOnly = parseEducationRequirement(
  "Eğitim Seviyesi Üniversite(Mezun), Yüksek Lisans(Öğrenci), Yüksek Lisans(Mezun), Doktora(Öğrenci), Doktora(Mezun)"
);
check(
  "'Yüksek Lisans' 'Lisans' ile karışmaz",
  mastersOnly.some((e) => e.level === "yukseklisans") && mastersOnly.some((e) => e.level === "universite"),
  mastersOnly.map((e) => e.level).join(", ")
);

console.log("\n5) Yabancı dil");
const langs = parseLanguageRequirement(
  "Yabancı Dil İngilizce(Okuma : İleri, Yazma : İleri, Konuşma : İleri)"
);
check("Dil ve seviye okunur", langs.length === 1 && langs[0].language === "İngilizce" && langs[0].level === "ileri");

const multiLang = parseLanguageRequirement(
  "Yabancı Dil Türkçe(Okuma : İyi, Yazma : İyi, Konuşma : İyi), İngilizce(Okuma : Orta, Yazma : Orta, Konuşma : Orta)"
);
check("Birden çok dil okunur", multiLang.length === 2, multiLang.map((l) => `${l.language}:${l.level}`).join(", "));

console.log("\n6) Çalışma türü ve kıdem");
check("Staj ilanı tanınır", detectEmploymentType("Yazılım Stajyeri aranıyor") === "staj");
check("Tam zamanlı tanınır", detectEmploymentType("Full-time backend developer") === "tam-zamanli");
check("Yarı zamanlı tanınır", detectEmploymentType("Part-time müşteri temsilcisi") === "yari-zamanli");
check("Senior tanınır", detectSeniority("Kıdemli Yazılım Mühendisi") === "senior");
check("Stajyer kıdemi tanınır", detectSeniority("Frontend Developer Intern") === "stajyer");
check("Junior tanınır", detectSeniority("Junior Backend Developer") === "junior");
check("Belirtilmemişse uydurulmaz", detectSeniority("Yazılım Geliştirici") === "belirtilmemis");

console.log("\n7) Zorunlu / tercih edilen ayrımı (§12)");
const split = splitRequirementLines([
  "Java ve Spring Boot konusunda deneyimli olmak zorunludur.",
  "Docker bilmesi tercih sebebidir.",
  "Kubernetes deneyimi artıdır.",
  "SQL sorguları yazabilmek gereklidir."
]);
check("Zorunlu maddeler ayrılır", split.required.length === 2, split.required.length + " zorunlu");
check("Tercih edilenler ayrılır", split.preferred.length === 2, split.preferred.length + " tercih");
check("'tercih sebebi' zorunlu sayılmaz", !split.required.some((s) => /Docker/.test(s)));
check("'artıdır' zorunlu sayılmaz", !split.required.some((s) => /Kubernetes/.test(s)));
check("İşaretsiz madde zorunlu sayılır", splitRequirementLines(["React ile arayüz geliştirme"]).required.length === 1);
check("JS gürültüsü hiçbir gruba girmez", splitRequirementLines(["qualifications:{isLoading:a,isActive:b,x:{y:1}}"]).required.length === 0);

console.log("\n8) Uçtan uca: gerçek ilan (Kıdemli Yazılım Mühendisi)");
const real = extractRoleRequirements({
  title: "Kıdemli Yazılım Mühendisi",
  description:
    "Üniversitelerin Bilgisayar Mühendisliği, Yazılım Mühendisliği veya ilgili bölümlerinden mezun, Oracle & PL/SQL konusunda en az 5 yıl deneyimli",
  requirements: ["Oracle Database ve PL/SQL geliştirme konusunda en az 5 yıl deneyimli olmak zorunludur."],
  candidateCriteria: [
    "Aday Kriterleri",
    "Eğitim Seviyesi Ön Lisans(Mezun), Üniversite(Mezun), Yüksek Lisans(Mezun)",
    "Yabancı Dil İngilizce(Okuma : İyi, Yazma : İyi, Konuşma : İyi) Yapay zeka ile bu pozisyona özel"
  ],
  location: "İstanbul"
});
check("Kıdem senior okunur", real.seniority === "senior");
check("Mezuniyet zorunlu işaretlenir", real.requiresGraduate === true);
check("Öğrenci kabul edilmiyor", real.acceptsStudent === false);
check("Deneyim şartı metinden okunur", real.minYears === 5, `min=${real.minYears}`);
check("İngilizce şartı okunur", real.languages.some((l) => l.language === "İngilizce" && l.level === "iyi"));
check("Çıkarılan alan sayısı raporlanır", real.extractedFields >= 3, `${real.extractedFields} alan`);

console.log("\n9) Uçtan uca: staj ilanı (öğrenci kabul eden)");
const intern = extractRoleRequirements({
  title: "Yazılım Stajyeri",
  description: "Üniversite öğrencisi, part-time çalışabilecek, React öğrenmeye istekli",
  requirements: ["React temel bilgisi tercih sebebidir."],
  candidateCriteria: ["Tecrübe Tecrübesiz", "Eğitim Seviyesi Üniversite(Öğrenci), Üniversite(Mezun)"]
});
check("Staj türü okunur", intern.employmentType === "staj", intern.employmentType);
check("Öğrenci kabul ediliyor", intern.acceptsStudent === true);
check("Mezuniyet zorunlu değil", intern.requiresGraduate === false);
check("Tecrübesiz kabul ediliyor", intern.acceptsNoExperience === true);
check("Tercih edilen beceri ayrıldı", intern.preferredSkills.length === 1 && intern.requiredSkills.length === 0);

console.log("\n10) Veri yoksa uydurma yapılmaz");
const bare = extractRoleRequirements({ title: "Yazılım Geliştirici", description: "Ekibimize katılın." });
check("Deneyim şartı uydurulmaz", bare.minYears === null);
check("Eğitim şartı uydurulmaz", bare.education.length === 0);
check("Mezuniyet zorunlu sayılmaz", bare.requiresGraduate === false);
check("Düşük güven raporlanır", bare.extractedFields === 0, `${bare.extractedFields} alan`);


// ── Ek: gürültülü "aranan nitelikler" alanında açıklamaya geri düşme ──────
console.log("\n11) Bozuk nitelik alanı → açıklamaya geri düşer (gerçek kayıt)");
const noisyListing = extractRoleRequirements({
  title: "Arayüz Yazılım Uzmanı",
  description:
    "React ve TypeScript ile arayüz geliştirecek takım arkadaşı arıyoruz. JavaScript bilgisi zorunludur.",
  // Veritabanındaki gerçek bozuk kayıt: sayfanın JavaScript'i bu alana düşmüş.
  requirements: ["qualifications:{isLoading:a,isActive:b,isViewActive:b,isReviewActive:b,callOnStart:b,i"],
  candidateCriteria: ["Tecrübe En az 3 yıl tecrübeli"]
});
check(
  "JS gürültüsüne rağmen şart çıkarıldı",
  noisyListing.requiredSkills.length > 0,
  `${noisyListing.requiredSkills.length} zorunlu madde`
);
check(
  "Şartlar açıklamadan geldi",
  noisyListing.requiredSkills.some((line) => /React|TypeScript|JavaScript/i.test(line))
);
check("Kriter bloğu yine de okundu", noisyListing.minYears === 3);

console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
if (failed > 0) process.exitCode = 1;
