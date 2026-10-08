import { computeSearchFingerprint, searchCacheTtlHours } from "../lib/jobs/search-fingerprint";

/**
 * Feature #8 — arama parmak izi birim testleri (AI/DB yok, deterministik).
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

const base = {
  userId: 7,
  cvId: 12,
  cvText: "Ali Veli — Frontend Developer. React, TypeScript, 4 yıl deneyim.",
  selectedPositions: ["Frontend Developer", "React Developer"],
  seniorityFilter: "any",
  locationMode: "all-turkey",
  cities: [] as string[],
  workMode: "any",
  searchNote: null
};

function main() {
  console.log("\n═══ Arama parmak izi testleri ═══\n");

  const fp = computeSearchFingerprint(base);

  check("sha256 hex üretiyor", /^[0-9a-f]{64}$/.test(fp), fp.slice(0, 16) + "…");

  check(
    "pozisyon sırası önemsiz",
    computeSearchFingerprint({ ...base, selectedPositions: ["React Developer", "Frontend Developer"] }) === fp
  );

  check(
    "büyük/küçük harf ve fazla boşluk önemsiz",
    computeSearchFingerprint({ ...base, selectedPositions: ["  FRONTEND   developer ", "react DEVELOPER"] }) === fp
  );

  check(
    "yinelenen pozisyon önemsiz",
    computeSearchFingerprint({
      ...base,
      selectedPositions: ["Frontend Developer", "React Developer", "Frontend Developer"]
    }) === fp
  );

  check(
    "şehir sırası önemsiz",
    computeSearchFingerprint({ ...base, locationMode: "cities", cities: ["İzmir", "Ankara"] }) ===
      computeSearchFingerprint({ ...base, locationMode: "cities", cities: ["Ankara", "İzmir"] })
  );

  check(
    "boş not ile null not aynı",
    computeSearchFingerprint({ ...base, searchNote: "   " }) === computeSearchFingerprint({ ...base, searchNote: null })
  );

  check(
    "CV metninin baş/son boşluğu önemsiz",
    computeSearchFingerprint({ ...base, cvText: `  ${base.cvText}  ` }) === fp
  );

  // Her kriter değişimi farklı parmak izi üretmeli.
  const variants: Array<[string, string]> = [
    ["farklı pozisyon", computeSearchFingerprint({ ...base, selectedPositions: ["Backend Developer"] })],
    ["farklı seviye", computeSearchFingerprint({ ...base, seniorityFilter: "senior" })],
    ["farklı konum modu", computeSearchFingerprint({ ...base, locationMode: "cities", cities: ["İstanbul"] })],
    ["farklı çalışma şekli", computeSearchFingerprint({ ...base, workMode: "remote" })],
    ["farklı not", computeSearchFingerprint({ ...base, searchNote: "Uzaktan öncelikli" })],
    ["farklı kullanıcı", computeSearchFingerprint({ ...base, userId: 8 })],
    ["farklı CV kaydı", computeSearchFingerprint({ ...base, cvId: 13 })],
    // Ana CV upsert edildiği için cvId sabit kalabilir; içerik değişimi tek
    // başına önbelleği düşürmek ZORUNDA (eski CV'nin skorları taşınmasın).
    ["aynı cvId, farklı CV metni", computeSearchFingerprint({ ...base, cvText: "Ali Veli — artık Backend Developer. Node.js, 5 yıl." })]
  ];

  for (const [label, variant] of variants) {
    check(`${label} → farklı parmak izi`, variant !== fp);
  }

  check(
    "tüm varyantlar birbirinden farklı (çakışma yok)",
    new Set([fp, ...variants.map(([, value]) => value)]).size === variants.length + 1
  );

  // TTL okuma
  const originalTtl = process.env.SEARCH_CACHE_TTL_HOURS;
  delete process.env.SEARCH_CACHE_TTL_HOURS;
  check("TTL varsayılanı 6 saat", searchCacheTtlHours() === 6);
  process.env.SEARCH_CACHE_TTL_HOURS = "0";
  check("TTL=0 önbelleği kapatır (0 döner)", searchCacheTtlHours() === 0);
  process.env.SEARCH_CACHE_TTL_HOURS = "abc";
  check("Bozuk TTL değeri varsayılana düşer", searchCacheTtlHours() === 6);
  if (originalTtl === undefined) {
    delete process.env.SEARCH_CACHE_TTL_HOURS;
  } else {
    process.env.SEARCH_CACHE_TTL_HOURS = originalTtl;
  }

  console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
  if (failed > 0) process.exitCode = 1;
}

main();
