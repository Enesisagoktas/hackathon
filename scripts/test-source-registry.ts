import "../lib/load-env";

import { closeDbPool } from "../lib/db";
import { buildGenericAdapter, buildQueryTokens, fillSearchTemplate } from "../lib/jobs/source-adapters";
import { companySlugCandidates } from "../lib/jobs/source-discovery";
import {
  professionTagsForProfile,
  scoreSourceForSelection,
  seedSourceRegistry,
  selectSourcesForRun,
  waveForPriority,
  type SourceRecord
} from "../lib/jobs/source-registry";
import type { CandidateProfile } from "../lib/jobs/types";

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

const NOW = new Date("2026-08-28T12:00:00Z");

const baseSource: SourceRecord = {
  sourceId: 1,
  name: "Test Kaynak",
  country: "TR",
  region: null,
  sourceType: "general-board",
  platformType: null,
  baseUrl: "https://ornek.com",
  searchUrlTemplate: "https://ornek.com/ara?q={query}",
  accessMethod: "html",
  searchSupported: true,
  browserRequired: false,
  apiAvailable: false,
  javascriptRequired: false,
  status: "active",
  priority: 20,
  healthScore: 0.5,
  reliabilityScore: 0.5,
  coverageScore: 0,
  lastScannedAt: null,
  lastSuccessAt: null,
  successfulScans: 0,
  totalScans: 0,
  newJobsFound: 0,
  relevantJobsFound: 0,
  invalidJobsFound: 0,
  duplicateJobsFound: 0,
  rateLimitMs: 2000,
  professionTags: "genel",
  discoveredFrom: null
};

const techProfile = {
  targetRole: "Backend Developer",
  titles: ["Java Developer"],
  skills: ["Java", "Spring"],
  languages: [],
  industries: ["Yazılım"],
  experienceAreas: [],
  keywords: ["backend"],
  locations: [],
  locationMode: "all-turkey",
  workMode: "any"
} as CandidateProfile;

const nurseProfile = {
  ...techProfile,
  targetRole: "Hemşire",
  titles: ["Servis Hemşiresi"],
  skills: ["Hasta bakımı"],
  industries: ["Sağlık"],
  keywords: ["hemşire"]
} as CandidateProfile;

async function main() {
  console.log("\n═══ Source Registry — seçim, rotasyon, adaptörler ═══\n");

  console.log("1) Meslek etiketleri (§3 dinamik kaynak kümeleri)");
  const techTags = professionTagsForProfile(techProfile);
  check("Yazılımcı profili tech etiketi alır", techTags.includes("tech"), techTags.join(","));
  const nurseTags = professionTagsForProfile(nurseProfile);
  check("Hemşire profili saglik etiketi alır", nurseTags.includes("saglik"), nurseTags.join(","));
  check("Hemşire profili tech etiketi ALMAZ", !nurseTags.includes("tech"));
  check("Genel etiket her profilde var", techTags.includes("genel") && nurseTags.includes("genel"));

  console.log("\n2) Kaynak puanlama (§5 rotasyon girdileri)");
  const techBoard = { ...baseSource, professionTags: "tech" };
  const techForTech = scoreSourceForSelection(techBoard, ["tech", "genel"], NOW);
  const techForNurse = scoreSourceForSelection(techBoard, ["saglik", "genel"], NOW);
  check(
    "Meslek uyumu puanı belirgin artırır",
    techForTech.score > techForNurse.score + 30,
    `tech→${Math.round(techForTech.score)} vs hemşire→${Math.round(techForNurse.score)}`
  );
  check("Alakasız niş kaynak cezalandırılır", techForNurse.score < 0, "hemşire aramasında tech board");

  const neverScanned = scoreSourceForSelection({ ...baseSource, lastScannedAt: null }, ["genel"], NOW);
  const justScanned = scoreSourceForSelection(
    { ...baseSource, lastScannedAt: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString() },
    ["genel"],
    NOW
  );
  check("Hiç taranmamış kaynak öne çıkar", neverScanned.score > justScanned.score, "keşif teşviki");

  const staleGood = scoreSourceForSelection(
    {
      ...baseSource,
      lastScannedAt: new Date(NOW.getTime() - 48 * 3600 * 1000).toISOString(),
      totalScans: 10,
      successfulScans: 9,
      reliabilityScore: 0.9,
      newJobsFound: 80,
      relevantJobsFound: 60
    },
    ["genel"],
    NOW
  );
  check(
    "Uzun süredir taranmamış KALİTELİ kaynak yeni taranmışın önüne geçer",
    staleGood.score > justScanned.score,
    `${Math.round(staleGood.score)} > ${Math.round(justScanned.score)}`
  );

  const dupHeavy = scoreSourceForSelection(
    { ...baseSource, totalScans: 10, newJobsFound: 100, duplicateJobsFound: 90, reliabilityScore: 0.9 },
    ["genel"],
    NOW
  );
  const freshYield = scoreSourceForSelection(
    { ...baseSource, totalScans: 10, newJobsFound: 100, duplicateJobsFound: 5, reliabilityScore: 0.9 },
    ["genel"],
    NOW
  );
  check("Hep aynı ilanları döndüren kaynak geriler", dupHeavy.score < freshYield.score, "§5 kopya cezası");

  console.log("\n3) Dalga ataması (§12)");
  check("Öncelik 1-5 → dalga 1", waveForPriority(3) === 1);
  check("Öncelik 10 → dalga 2", waveForPriority(10) === 2);
  check("Öncelik 25 → dalga 3", waveForPriority(25) === 3);
  check("Öncelik 45 → dalga 4", waveForPriority(45) === 4);

  console.log("\n4) Gerçek seçim (veritabanı üzerinden, §1+§6)");
  await seedSourceRegistry();
  const techSelection = await selectSourcesForRun(techProfile, { now: NOW });
  const names = techSelection.map((source) => source.name);
  check(
    "Başlangıç önceliği 5 kaynak HER seçimde var",
    ["Kariyer.net", "Eleman.net", "İşin Olsun", "Indeed TR", "LinkedIn"].every((name) => names.includes(name)),
    names.slice(0, 5).join(", ")
  );
  check("Seçim limiti aşılmaz", techSelection.length <= 14, `${techSelection.length} kaynak`);
  check("Aynı kaynak iki kez seçilmez", new Set(names).size === names.length);

  const typeCounts = new Map<string, number>();
  techSelection
    .filter((source) => source.wave !== 1)
    .forEach((source) => typeCounts.set(source.sourceType, (typeCounts.get(source.sourceType) ?? 0) + 1));
  check(
    "Tür çeşitliliği: dalga 1 dışında türden en fazla 3+1 kaynak",
    Array.from(typeCounts.values()).every((count) => count <= 4),
    Array.from(typeCounts.entries()).map(([type, count]) => `${type}=${count}`).join(", ")
  );

  const nurseSelection = await selectSourcesForRun(nurseProfile, { now: NOW });
  const techOnly = techSelection.filter((s) => s.wave > 1).map((s) => s.name);
  const nurseOnly = nurseSelection.filter((s) => s.wave > 1).map((s) => s.name);
  const overlap = techOnly.filter((name) => nurseOnly.includes(name)).length;
  check(
    "Farklı meslekler farklı kaynak kümeleri alır (§3)",
    techOnly.length - overlap >= 2 || nurseOnly.length - overlap >= 2,
    `yazılımcıya özel: ${techOnly.filter((n) => !nurseOnly.includes(n)).slice(0, 4).join(", ")}`
  );

  console.log("\n5) Genel adaptör (§2)");
  check(
    "Şablon doldurma: {query}",
    fillSearchTemplate("https://x.com/ara?q={query}", "Backend Developer") === "https://x.com/ara?q=Backend%20Developer"
  );
  check(
    "Şablon doldurma: {query_slug}",
    fillSearchTemplate("https://x.com/is/{query_slug}", "Yazılım Geliştirici") === "https://x.com/is/yazilim-gelistirici"
  );

  const adapter = buildGenericAdapter({ ...baseSource, baseUrl: "https://ornek.com" });
  check("Yabancı alan adı reddedilir", !adapter.isDetailUrl(new URL("https://baskasite.com/is-ilani/x-123456")));
  check("Sayısal kimlikli detay kabul edilir", adapter.isDetailUrl(new URL("https://ornek.com/is-ilani/kidemli-muhendis-123456")));
  check(
    "Kategori sayfası tuzağı reddedilir (ölçümdeki İşin Olsun durumu)",
    !adapter.isDetailUrl(new URL("https://ornek.com/is-ilanlari/kurye")),
    "/is-ilanlari/kurye detay değil"
  );
  check(
    "Uzun kimlikli detay kabul edilir",
    adapter.isDetailUrl(new URL("https://ornek.com/is-ilani/garson-soa-yemek-0iojAF1D75A80CC3481ABF1C99"))
  );
  check("Arama sayfası reddedilir", !adapter.isDetailUrl(new URL("https://ornek.com/arama?q=test")));

  console.log("\n6) Sorgu belirteçleri (yapılandırılmış kaynak süzmesi)");
  const tokens = buildQueryTokens(["Backend Developer", "Java Developer"]);
  check("Belirteçler normalize ve tekil", tokens.includes("backend") && tokens.includes("java"), tokens.join(","));
  check("Kısa kelimeler atılır", !tokens.includes("ve"));

  console.log("\n7) ATS slug üretimi (keşif)");
  const slugs = companySlugCandidates("Dream Games Teknoloji A.Ş.");
  check("Hukuki ekler atılır, slug üretilir", slugs.includes("dream-games"), slugs.join(","));
  check("Bitişik varyant üretilir", slugs.includes("dreamgames"));
  check("Kısa/boş ad slug üretmez", companySlugCandidates("A.Ş.").length === 0);

  console.log(`\n═══ Sonuç: ${passed} geçti, ${failed} kaldı ═══\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Test çöktü:", error);
    process.exitCode = 1;
  })
  .finally(() => closeDbPool().catch(() => undefined));
