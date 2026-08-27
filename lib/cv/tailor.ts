import { generateJsonWithGemini } from "@/lib/gemini";
import { normalizeComparable } from "@/lib/jobs/normalize";
import { dedupe } from "@/lib/cv/structured";
import { SKILL_DICTIONARY } from "@/lib/cv/skill-dictionary";
import type {
  ExperienceEntry,
  GapItem,
  KeywordAlignmentItem,
  StructuredCv,
  TailoredCv,
  TailoringListing,
  TailoringResult
} from "@/lib/cv/types";

/**
 * CV'yi tek bir ilana göre yeniden kurgular.
 *
 * ÜRÜN KURALI — uydurma yasağı:
 * İlanın istediği bir beceri CV'de yoksa CV'ye EKLENMEZ. AI çıktısı
 * `enforceEvidence()` ile ana CV metnine karşı doğrulanır; dayanağı olmayan
 * beceriler atılır ve `gaps` raporuna düşer. Böylece uyarlanmış CV her zaman
 * doğrulanabilir kalır.
 */
export async function tailorCvForListing(input: {
  masterCv: StructuredCv;
  masterText: string;
  listing: TailoringListing;
  matchScore: number;
  applicantEmail?: string;
}): Promise<TailoringResult> {
  const { masterCv, masterText, listing } = input;
  const evidence = buildEvidenceIndex(masterCv, masterText);
  const listingTerms = extractListingTerms(listing);

  try {
    const parsed = await generateJsonWithGemini<Record<string, unknown>>(
      TAILOR_SYSTEM_INSTRUCTION,
      buildTailorPrompt(input, listingTerms),
      {
        timeoutMs: Number(process.env.CV_TAILOR_TIMEOUT_MS ?? 35000),
        maxAttempts: Number(process.env.CV_TAILOR_MAX_ATTEMPTS ?? 2)
      }
    );

    const result = shapeAiResult(parsed, input, listingTerms, evidence);

    if (result.tailoredCv.highlightedSkills.length || result.tailoredCv.experience.length) {
      return result;
    }
  } catch (error) {
    console.warn(
      `[tailor] Gemini uyarlama başarısız (${listing.title}), kural tabanlı yedeğe düşülüyor:`,
      error instanceof Error ? error.message : String(error)
    );
  }

  return buildHeuristicTailoring(input, listingTerms, evidence);
}

// ─── AI yolu ──────────────────────────────────────────────────────────────

const TAILOR_SYSTEM_INSTRUCTION = `Sen Türkiye iş piyasasını bilen kıdemli bir kariyer danışmanısın. Adayın ana CV'sini TEK bir iş ilanına göre yeniden kurguluyorsun.

MUTLAKA bu JSON şemasına uy:
{
  "headline": string,
  "summary": string,
  "highlightedSkills": string[],
  "adjacentSkills": string[],
  "skillGroups": [ { "title": string, "skills": string[] } ],
  "experience": [ { "role": string, "company": string, "period": string, "location": string, "bullets": string[], "skills": string[] } ],
  "coverLetter": string,
  "emailSubject": string,
  "gaps": [ { "requirement": string, "note": string, "severity": "critical" | "nice-to-have" } ],
  "keywordAlignment": [ { "term": string, "status": "covered" | "partial" | "missing", "evidence": string } ],
  "changeNotes": string[]
}

MUTLAK KURALLAR — bunları çiğnemek sistemi bozar:
1. UYDURMA YASAĞI: Ana CV'de kanıtı olmayan hiçbir beceri, teknoloji, sertifika, şirket, unvan veya sayısal başarı yazma. İlan istiyor diye ekleme.
2. İlanın istediği ama CV'de OLMAYAN her gereksinim "gaps" dizisine girer; CV'nin içine ASLA girmez.
3. "highlightedSkills": ilanın istediği VE adayın CV'sinde kanıtı olan beceriler. Sadece bunlar.
4. "adjacentSkills": ilanda geçmeyen ama bu işveren için değerli olabilecek, adayda GERÇEKTEN olan beceriler.
5. Deneyim maddelerini yeniden YAZABİLİRSİN ama sadece dili hizalamak için: ilanın terminolojisini kullan, ilanla ilgili işi öne al, alakasız detayı kısalt. İçeriği değiştirme, yeni iş/sonuç ekleme.
6. Deneyimleri ilana yakınlığa göre sırala; en alakalı en üstte olsun.
7. experience.bullets: her madde tek cümle, eylem fiiliyle başlasın, en fazla 25 kelime.
8. summary: 2-4 cümle, ilandaki role doğrudan hitap etsin, sadece CV'deki gerçeklere dayansın.
9. coverLetter: Türkçe, 130-200 kelime, samimi ve net; şirket ve rol adını kullan; abartı ve klişe yok. Eksik yetkinlik varsa dürüstçe "hızlı öğrenme" iddiası yerine mevcut yakın deneyimi öne çıkar.
10. changeNotes: neyi neden değiştirdiğini 3-6 madde ile Türkçe açıkla.
11. Çıktının tamamı Türkçe olsun (teknoloji/araç adları hariç).`;

function buildTailorPrompt(
  input: { masterCv: StructuredCv; masterText: string; listing: TailoringListing; matchScore: number },
  listingTerms: ListingTerms
): string {
  const { masterCv, listing, matchScore } = input;

  return `İŞ İLANI
Pozisyon: ${listing.title}
Şirket: ${listing.company ?? "Belirtilmemiş"}
Lokasyon: ${listing.location ?? "Belirtilmemiş"}
Çalışma modeli: ${listing.workMode ?? "Belirtilmemiş"}
Platform: ${listing.platform ?? "Belirtilmemiş"}
Ön eşleşme skoru: ${matchScore}/100

İlan açıklaması:
${listing.description.slice(0, 4000)}

Aranan nitelikler:
${listing.requirements.slice(0, 15).map((item) => `- ${item}`).join("\n") || "- (ilanda ayrı bir nitelik listesi yok)"}

Aday kriterleri:
${listing.candidateCriteria.slice(0, 10).map((item) => `- ${item}`).join("\n") || "- (belirtilmemiş)"}

İlandan çıkarılan beceri terimleri: ${listingTerms.skills.join(", ") || "yok"}

────────────────────────────────────────────

ADAYIN ANA CV'Sİ (tek gerçek kaynak — bunun dışına çıkma)
${JSON.stringify(
  {
    contact: masterCv.contact,
    headline: masterCv.headline,
    summary: masterCv.summary,
    experience: masterCv.experience,
    education: masterCv.education,
    skills: masterCv.skills,
    certifications: masterCv.certifications,
    languages: masterCv.languages,
    projects: masterCv.projects,
    extras: masterCv.extras
  },
  null,
  2
).slice(0, 14000)}

Bu CV'yi yukarıdaki ilana göre yeniden kurgula.`;
}

function shapeAiResult(
  parsed: Record<string, unknown>,
  input: { masterCv: StructuredCv; listing: TailoringListing; applicantEmail?: string },
  listingTerms: ListingTerms,
  evidence: EvidenceIndex
): TailoringResult {
  const { masterCv, listing } = input;

  // AI'nin önerdiği becerileri ana CV kanıtına karşı filtrele.
  const highlightedSkills = enforceEvidence(asStringArray(parsed.highlightedSkills), evidence);
  const adjacentSkills = enforceEvidence(asStringArray(parsed.adjacentSkills), evidence)
    .filter((skill) => !containsTerm(highlightedSkills, skill));

  const skillGroups = asArray(parsed.skillGroups)
    .map((group) => {
      const record = asRecord(group);
      return {
        title: asString(record.title) ?? "Diğer beceriler",
        skills: enforceEvidence(asStringArray(record.skills), evidence).filter(
          (skill) => !containsTerm(highlightedSkills, skill) && !containsTerm(adjacentSkills, skill)
        )
      };
    })
    .filter((group) => group.skills.length > 0)
    .slice(0, 5);

  const experience = asArray(parsed.experience)
    .map((entry) => toExperienceEntry(entry, evidence))
    .filter((entry) => entry.role.length > 1)
    .slice(0, 10);

  const tailoredCv: TailoredCv = {
    contact: masterCv.contact,
    headline: asString(parsed.headline) ?? listing.title,
    summary: asString(parsed.summary) ?? masterCv.summary ?? "",
    highlightedSkills: highlightedSkills.slice(0, 14),
    adjacentSkills: adjacentSkills.slice(0, 10),
    skillGroups,
    experience: experience.length ? experience : masterCv.experience,
    education: masterCv.education,
    certifications: masterCv.certifications,
    languages: masterCv.languages,
    projects: masterCv.projects,
    source: "ai"
  };

  // AI'nin bildirdiği eksikleri, kanıt filtresinde elenen becerilerle birleştir.
  const aiGaps = asArray(parsed.gaps).map(toGapItem).filter((gap) => gap.requirement.length > 2);
  const derivedGaps = deriveGaps(listingTerms, evidence);
  const gaps = mergeGaps([...aiGaps, ...derivedGaps]).slice(0, 12);

  const keywordAlignment = buildKeywordAlignment(listingTerms, evidence, asArray(parsed.keywordAlignment));

  return {
    tailoredCv,
    coverLetter: asString(parsed.coverLetter) ?? buildFallbackCoverLetter(masterCv, listing, highlightedSkills),
    emailSubject: asString(parsed.emailSubject) ?? buildEmailSubject(masterCv, listing),
    gaps,
    keywordAlignment,
    changeNotes: asStringArray(parsed.changeNotes).slice(0, 8),
    source: "ai"
  };
}

function toExperienceEntry(value: unknown, evidence: EvidenceIndex): ExperienceEntry {
  const record = asRecord(value);
  return {
    role: asString(record.role) ?? "",
    company: asString(record.company),
    period: asString(record.period),
    location: asString(record.location),
    bullets: asStringArray(record.bullets).slice(0, 10),
    skills: enforceEvidence(asStringArray(record.skills), evidence).slice(0, 12)
  };
}

// ─── Kanıt indeksi ve uydurma engeli ──────────────────────────────────────

export type EvidenceIndex = {
  /** Ana CV'nin tamamının normalize edilmiş hali. */
  haystack: string;
  /** Ana CV'de açıkça listelenmiş beceriler (normalize → orijinal). */
  skills: Map<string, string>;
};

function buildEvidenceIndex(masterCv: StructuredCv, masterText: string): EvidenceIndex {
  const skills = new Map<string, string>();

  const declared = [
    ...masterCv.skills,
    ...masterCv.certifications,
    ...masterCv.languages.map((item) => item.name),
    ...masterCv.experience.flatMap((item) => item.skills),
    ...masterCv.projects.flatMap((item) => item.skills)
  ];

  for (const skill of declared) {
    const key = normalizeComparable(skill);
    if (key.length >= 2 && !skills.has(key)) {
      skills.set(key, skill.trim());
    }
  }

  const structuredText = [
    masterText,
    masterCv.summary ?? "",
    masterCv.headline ?? "",
    ...masterCv.experience.flatMap((item) => [item.role, item.company ?? "", ...item.bullets]),
    ...masterCv.education.flatMap((item) => [item.degree, item.school ?? "", item.detail ?? ""]),
    ...masterCv.projects.flatMap((item) => [item.name, item.detail ?? ""]),
    ...masterCv.extras
  ].join(" \n ");

  return { haystack: normalizeComparable(structuredText), skills };
}

/**
 * Bir becerinin ana CV'de gerçekten kanıtı var mı?
 * Ya beceri listesinde geçer ya da CV metninde tam kelime olarak bulunur.
 */
export function hasEvidence(term: string, evidence: EvidenceIndex): boolean {
  const key = normalizeComparable(term);

  if (key.length < 2) {
    return false;
  }

  if (evidence.skills.has(key)) {
    return true;
  }

  // Çok kısa terimlerde (go, r, c) yanlış eşleşmeyi önlemek için sınır kontrolü.
  if (key.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(key)}([^a-z0-9]|$)`).test(evidence.haystack);
  }

  if (evidence.haystack.includes(key)) {
    return true;
  }

  // "React.js" ↔ "React" gibi varyantlar için beceri listesinde parça araması.
  for (const declaredKey of Array.from(evidence.skills.keys())) {
    if (declaredKey.length >= 3 && (declaredKey.includes(key) || key.includes(declaredKey))) {
      return true;
    }
  }

  return false;
}

/** Kanıtı olmayan terimleri eler. Uydurma engelinin uygulandığı yer. */
function enforceEvidence(terms: string[], evidence: EvidenceIndex): string[] {
  const kept: string[] = [];

  for (const term of dedupe(terms)) {
    if (hasEvidence(term, evidence)) {
      kept.push(term.trim());
    } else {
      console.log(`[tailor] Kanıtsız beceri elendi: "${term}"`);
    }
  }

  return kept;
}

// ─── İlan terimleri ───────────────────────────────────────────────────────

/**
 * İlan terimleri iki ayrı kümede tutulur:
 *
 * - `skills`: sözlükten yakalanan tekil araç/yetkinlik adları ("React", "İhracat").
 *   Bunlar CV'de tek tek aranabilir, dolayısıyla eksiklik iddiası güvenilirdir.
 * - `requirements`: ilanın nitelik cümleleri ("React ile en az 3 yıl deneyim").
 *   Bir cümleyi olduğu gibi CV'de aramak anlamsızdır; içindeki beceriler
 *   karşılanıyorsa cümle eksik sayılmaz.
 */
export type ListingTerms = {
  skills: string[];
  requirements: string[];
};

export function extractListingTerms(listing: TailoringListing): ListingTerms {
  const sources = [listing.title, ...listing.requirements, ...listing.candidateCriteria, listing.description.slice(0, 3000)];
  const text = sources.join("\n");
  const skills: string[] = [];

  for (const term of SKILL_DICTIONARY) {
    if (new RegExp(`(^|[^a-zA-Z0-9+#.])${escapeRegExp(term)}([^a-zA-Z0-9+#.]|$)`, "i").test(text)) {
      skills.push(term);
    }
  }

  const requirements: string[] = [];
  for (const line of [...listing.requirements, ...listing.candidateCriteria]) {
    const cleaned = line.replace(/^[\s•\-–—*·]+/, "").trim();
    if (cleaned.length >= 12 && cleaned.length <= 160) {
      requirements.push(cleaned);
    }
  }

  return {
    skills: dropSubsumedTerms(dedupe(skills)).slice(0, 25),
    requirements: dedupe(requirements).slice(0, 15)
  };
}

/**
 * Daha uzun bir terimin içinde geçen kısa terimleri eler.
 * "Tailwind CSS" yakalandıysa ayrıca "Tailwind" listelenmez.
 */
function dropSubsumedTerms(terms: string[]): string[] {
  const normalized = terms.map((term) => ({ term, key: normalizeComparable(term) }));

  return normalized
    .filter(({ key }) =>
      !normalized.some((other) => other.key !== key && other.key.length > key.length && other.key.includes(key))
    )
    .map(({ term }) => term);
}

/** Bir nitelik cümlesinin içinde geçen sözlük becerileri. */
function skillsInRequirement(requirement: string, listingSkills: string[]): string[] {
  return listingSkills.filter((skill) =>
    new RegExp(`(^|[^a-zA-Z0-9+#.])${escapeRegExp(skill)}([^a-zA-Z0-9+#.]|$)`, "i").test(requirement)
  );
}


// ─── Eksik (gap) raporu ───────────────────────────────────────────────────

/**
 * İlanın istediği ama CV'de kanıtı olmayanları raporlar.
 *
 * İki gürültü kaynağı bilinçli olarak dışarıda bırakılır:
 *  - İçindeki becerilerin hepsi CV'de olan nitelik cümleleri (yanlış alarm).
 *  - Hiçbir somut beceri içermeyen cümleler ("takım çalışmasına yatkın") —
 *    metin araması bunları doğrulayamaz, "eksik" demek yanıltıcı olur.
 */
function deriveGaps(listingTerms: ListingTerms, evidence: EvidenceIndex): GapItem[] {
  const gaps: GapItem[] = [];

  for (const skill of listingTerms.skills) {
    if (!hasEvidence(skill, evidence)) {
      gaps.push({
        requirement: skill,
        note: "İlan bu beceriyi istiyor ancak CV'nizde kanıtı bulunamadı. CV'ye eklenmedi — gerçekten deneyiminiz varsa ana CV'nize ekleyin.",
        severity: "critical"
      });
    }
  }

  for (const requirement of listingTerms.requirements) {
    const contained = skillsInRequirement(requirement, listingTerms.skills);

    if (!contained.length) {
      continue;
    }

    const missing = contained.filter((skill) => !hasEvidence(skill, evidence));

    if (!missing.length) {
      continue;
    }

    gaps.push({
      requirement,
      note: `Bu gereksinimde eksik olan: ${missing.join(", ")}. CV'ye eklenmedi.`,
      severity: isCriticalTerm(requirement) ? "critical" : "nice-to-have"
    });
  }

  return gaps.slice(0, 12);
}

function isCriticalTerm(term: string): boolean {
  return /zorunlu|şart|mutlaka|en az \d+ yıl|required|must have/i.test(term);
}

function mergeGaps(gaps: GapItem[]): GapItem[] {
  const seen = new Map<string, GapItem>();

  for (const gap of gaps) {
    const key = normalizeComparable(gap.requirement);
    if (!key) continue;

    const existing = seen.get(key);
    // Aynı gereksinim iki kez geldiyse daha ciddi olanı sakla.
    if (!existing || (existing.severity === "nice-to-have" && gap.severity === "critical")) {
      seen.set(key, gap);
    }
  }

  return Array.from(seen.values());
}

function buildKeywordAlignment(
  listingTerms: ListingTerms,
  evidence: EvidenceIndex,
  aiItems: unknown[]
): KeywordAlignmentItem[] {
  const aiByTerm = new Map<string, Record<string, unknown>>();

  for (const item of aiItems) {
    const record = asRecord(item);
    const term = asString(record.term);
    if (term) {
      aiByTerm.set(normalizeComparable(term), record);
    }
  }

  // Hizalama tablosu tekil beceriler üzerinden kurulur; cümleler değil.
  return listingTerms.skills.slice(0, 25).map((term) => {
    const covered = hasEvidence(term, evidence);
    const aiItem = aiByTerm.get(normalizeComparable(term));
    const aiStatus = asString(aiItem?.status);

    // Kanıt kontrolü AI'yi ezer: kanıt yoksa "covered" diyemez.
    const status: KeywordAlignmentItem["status"] = covered
      ? aiStatus === "partial"
        ? "partial"
        : "covered"
      : "missing";

    return {
      term,
      status,
      evidence: covered ? asString(aiItem?.evidence) ?? findEvidenceSnippet(term, evidence) : undefined
    };
  });
}

function findEvidenceSnippet(term: string, evidence: EvidenceIndex): string | undefined {
  const key = normalizeComparable(term);
  const declared = evidence.skills.get(key);

  if (declared) {
    return `CV beceri listesinde: ${declared}`;
  }

  const index = evidence.haystack.indexOf(key);
  if (index < 0) {
    return undefined;
  }

  return `...${evidence.haystack.slice(Math.max(0, index - 40), index + key.length + 40).trim()}...`;
}

// ─── Kural tabanlı yedek uyarlama ─────────────────────────────────────────

/**
 * Gemini yokken çalışan uyarlama. AI kadar akıcı değil ama aynı ürün kuralını
 * uygular: ilanın istediklerinden CV'de kanıtı olanları öne çıkarır, olmayanları
 * eksik raporuna yazar.
 */
function buildHeuristicTailoring(
  input: { masterCv: StructuredCv; listing: TailoringListing; matchScore: number },
  listingTerms: ListingTerms,
  evidence: EvidenceIndex
): TailoringResult {
  const { masterCv, listing } = input;

  const highlightedSkills = listingTerms.skills
    .filter((term) => hasEvidence(term, evidence))
    .map((term) => evidence.skills.get(normalizeComparable(term)) ?? term)
    .slice(0, 14);

  const adjacentSkills = masterCv.skills
    .filter((skill) => !containsTerm(highlightedSkills, skill))
    .slice(0, 10);

  const remaining = masterCv.skills.filter(
    (skill) => !containsTerm(highlightedSkills, skill) && !containsTerm(adjacentSkills, skill)
  );

  const experience = rankExperienceByRelevance(masterCv.experience, listingTerms);

  const tailoredCv: TailoredCv = {
    contact: masterCv.contact,
    headline: listing.title,
    summary: buildHeuristicSummary(masterCv, listing, highlightedSkills),
    highlightedSkills,
    adjacentSkills,
    skillGroups: remaining.length ? [{ title: "Diğer beceriler", skills: remaining.slice(0, 20) }] : [],
    experience,
    education: masterCv.education,
    certifications: masterCv.certifications,
    languages: masterCv.languages,
    projects: masterCv.projects,
    source: "heuristic"
  };

  return {
    tailoredCv,
    coverLetter: buildFallbackCoverLetter(masterCv, listing, highlightedSkills),
    emailSubject: buildEmailSubject(masterCv, listing),
    gaps: mergeGaps(deriveGaps(listingTerms, evidence)),
    keywordAlignment: buildKeywordAlignment(listingTerms, evidence, []),
    changeNotes: [
      `Başlık ilanın pozisyonuna göre "${listing.title}" olarak hizalandı.`,
      highlightedSkills.length
        ? `İlanın istediği ve CV'nizde kanıtı olan ${highlightedSkills.length} beceri en üste taşındı.`
        : "İlanın istediği becerilerden CV'nizde doğrudan kanıtı olan bulunamadı.",
      "Deneyimler ilanla ilgililik sırasına göre yeniden dizildi.",
      "İlanın istediği ama CV'de bulunmayan hiçbir beceri eklenmedi; eksikler ayrı raporda listelendi.",
      "Gemini anahtarı tanımlı olmadığı için kural tabanlı uyarlama kullanıldı."
    ],
    source: "heuristic"
  };
}

/** Deneyimleri ilan terimleriyle örtüşme sayısına göre sıralar. */
function rankExperienceByRelevance(experience: ExperienceEntry[], listingTerms: ListingTerms): ExperienceEntry[] {
  const normalizedTerms = listingTerms.skills.map(normalizeComparable).filter((term) => term.length >= 3);

  return experience
    .map((entry, index) => {
      const text = normalizeComparable([entry.role, entry.company ?? "", ...entry.bullets, ...entry.skills].join(" "));
      const hits = normalizedTerms.filter((term) => text.includes(term)).length;
      return { entry, hits, index };
    })
    // Eşit ilgililikte CV'deki orijinal (kronolojik) sıra korunur.
    .sort((left, right) => right.hits - left.hits || left.index - right.index)
    .map((item) => item.entry);
}

function buildHeuristicSummary(masterCv: StructuredCv, listing: TailoringListing, highlighted: string[]): string {
  const lastRole = masterCv.experience[0]?.role ?? masterCv.headline ?? "Aday";
  const company = listing.company ? `${listing.company} bünyesindeki` : "İlandaki";
  const skillText = highlighted.length ? ` ${highlighted.slice(0, 5).join(", ")} alanlarındaki deneyimimi` : " mevcut deneyimimi";

  return `${lastRole} olarak edindiğim deneyimle ${company} ${listing.title} pozisyonuna başvuruyorum.${skillText} bu rolün gereksinimleriyle doğrudan ilişkilendiriyorum.${
    masterCv.summary ? ` ${masterCv.summary.slice(0, 220)}` : ""
  }`.trim();
}

function buildFallbackCoverLetter(masterCv: StructuredCv, listing: TailoringListing, highlighted: string[]): string {
  const name = masterCv.contact.fullName || "Aday";
  const company = listing.company ?? "Şirketiniz";
  const lastRole = masterCv.experience[0]?.role;

  const lines = [
    "Merhaba,",
    "",
    `${company} bünyesinde açık olan ${listing.title} pozisyonu için başvurumu iletiyorum.`,
    lastRole
      ? `${lastRole} rolünde edindiğim deneyim, bu pozisyonun gerektirdiği sorumluluklarla doğrudan örtüşüyor.`
      : "Geçmiş deneyimlerim bu pozisyonun gerektirdiği sorumluluklarla örtüşüyor.",
    highlighted.length
      ? `Özellikle ${highlighted.slice(0, 4).join(", ")} konularındaki çalışmalarım ilanda öne çıkan gereksinimlerle eşleşiyor.`
      : "İlanda öne çıkan gereksinimlere dair deneyimimi ekteki CV'de detaylandırdım.",
    "",
    "Pozisyona uyarlanmış CV'mi ekte bulabilirsiniz. Detayları görüşebilmek için uygun olduğunuz bir zamanda görüşme fırsatı verirseniz memnun olurum.",
    "",
    "Saygılarımla,",
    name,
    [masterCv.contact.email, masterCv.contact.phone].filter(Boolean).join(" · ")
  ];

  return lines.filter((line) => line !== undefined).join("\n");
}

function buildEmailSubject(masterCv: StructuredCv, listing: TailoringListing): string {
  const name = masterCv.contact.fullName || "Başvuru";
  return `${listing.title} Başvurusu — ${name}`.slice(0, 200);
}

// ─── Yardımcılar ──────────────────────────────────────────────────────────

function containsTerm(list: string[], term: string): boolean {
  const key = normalizeComparable(term);
  return list.some((item) => normalizeComparable(item) === key);
}

function toGapItem(value: unknown): GapItem {
  const record = asRecord(value);
  return {
    requirement: asString(record.requirement) ?? "",
    note: asString(record.note) ?? "İlan bu gereksinimi istiyor; CV'nizde kanıtı bulunamadı.",
    severity: record.severity === "critical" ? "critical" : "nice-to-have"
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
