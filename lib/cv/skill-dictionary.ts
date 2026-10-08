import { normalizeComparable } from "@/lib/jobs/normalize";

/**
 * Bilinen beceri/araç/yetkinlik adları.
 *
 * İki yerde kullanılır:
 *  1. İlan metninden aranan becerileri çıkarmak (`lib/cv/tailor.ts`).
 *  2. PDF metin çıkarımında birbirine yapışmış beceri bloklarını ayırmak
 *     (`lib/cv/structured.ts`).
 */
export const SKILL_DICTIONARY = [
  // Diller ve çalışma zamanları
  "JavaScript", "TypeScript", "Python", "Java", "Kotlin", "Swift", "Objective-C",
  "C++", "C#", ".NET", "PHP", "Ruby", "Go", "Rust", "Scala", "Perl", "Dart", "R",
  "MATLAB", "VBA", "Shell", "Bash", "PowerShell",
  // Frontend
  "React Native", "React", "Next.js", "Vue", "Nuxt", "Angular", "Svelte", "jQuery",
  "HTML", "CSS", "SASS", "SCSS", "LESS", "Tailwind CSS", "Tailwind", "Bootstrap",
  "Material UI", "Redux", "MobX", "Zustand", "Webpack", "Vite", "Storybook",
  // Backend
  "Node.js", "Express", "NestJS", "Django", "Flask", "FastAPI", "Spring Boot",
  "Spring", "Laravel", "Symfony", "Rails", "GraphQL", "REST", "gRPC", "WebSocket",
  "Microservices", "Mikroservis",
  // Veri
  "PostgreSQL", "MySQL", "MongoDB", "SQL Server", "Oracle", "SQLite", "Redis",
  "Elasticsearch", "Cassandra", "DynamoDB", "SQL", "NoSQL", "Kafka", "RabbitMQ",
  "Airflow", "Spark", "Hadoop", "dbt", "Snowflake", "BigQuery",
  // DevOps / bulut
  "Docker", "Kubernetes", "Terraform", "Ansible", "Jenkins", "GitLab CI",
  "GitHub Actions", "CI/CD", "AWS", "Azure", "GCP", "Linux", "Nginx", "Apache",
  "Prometheus", "Grafana", "Git", "SVN",
  // Test
  "Jest", "Vitest", "Cypress", "Playwright", "Selenium", "JUnit", "pytest",
  "Postman", "SoapUI",
  // Veri bilimi / analitik
  "pandas", "NumPy", "scikit-learn", "TensorFlow", "PyTorch", "Keras", "OpenCV",
  "Power BI", "Tableau", "Looker", "Google Analytics", "Excel", "Google Data Studio",
  // Tasarım
  "Figma", "Adobe XD", "Sketch", "Photoshop", "Illustrator", "InDesign",
  "After Effects", "Premiere Pro", "Canva", "AutoCAD", "SolidWorks", "CATIA",
  "SketchUp", "Revit", "3ds Max",
  // İş uygulamaları
  "Salesforce", "HubSpot", "SAP", "Logo", "Mikro", "Netsis", "Nebim", "Zoho",
  "Dynamics", "Jira", "Confluence", "Trello", "Asana", "Notion", "Slack",
  "MS Project", "Primavera",
  // Yöntem
  "Scrum", "Agile", "Kanban", "Waterfall", "ITIL", "Six Sigma", "Lean",
  "ISO 9001", "ISO 27001", "PMP", "Prince2",
  // Pazarlama / satış
  "SEO", "SEM", "Google Ads", "Meta Ads", "LinkedIn Ads", "E-ticaret",
  "İçerik Pazarlama", "Sosyal Medya Yönetimi", "CRM", "ERP", "B2B", "B2C",
  // Dış ticaret / lojistik
  "İhracat", "İthalat", "Dış Ticaret", "Gümrük", "Incoterms", "Akreditif",
  "Lojistik", "Tedarik Zinciri", "Depo Yönetimi",
  // Finans / muhasebe / İK
  "Muhasebe", "Ön Muhasebe", "Bordro", "SGK", "Finansal Analiz", "Bütçe",
  "Maliyet Muhasebesi", "Vergi Mevzuatı", "İşe Alım", "Performans Yönetimi",
  // Diller
  "İngilizce", "Almanca", "Fransızca", "İspanyolca", "İtalyanca", "Rusça",
  "Arapça", "Çince", "Japonca",
  // Genel yetkinlikler
  "Proje Yönetimi", "Ekip Yönetimi", "İş Geliştirme", "Müşteri İlişkileri",
  "Raporlama", "Sunum", "Müzakere", "Analitik Düşünme",
  "Uluslararası Pazarlama", "Pazar Araştırması", "Export Marketing",
  "Dijital Pazarlama", "Marka Yönetimi", "Satış Yönetimi", "Kalite Kontrol",
  "İş Analizi", "Süreç İyileştirme", "Eğitim ve Gelişim"
];

/**
 * Uzunluğu KORUYAN harf katlaması: Türkçe locale ile küçültme + aksan
 * sadeleştirmesi. Her değişim tek karakter → tek karakter olduğu için
 * katlanmış metnin indeksleri orijinal metinle birebir hizalı kalır; bu
 * sayede eşleşmeyen parçaları ÖZGÜN yazımıyla geri kesebiliriz.
 *
 * (`normalizeComparable` bunu yapamaz: noktalama dizilerini tek boşluğa
 * indirdiği için uzunluğu değiştirir.)
 */
function foldPreservingLength(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c");
}

/**
 * Sözlük girdileri, uzun terimler önce gelecek şekilde sıralanır. Açgözlü
 * eşleştirmede "React Native"in "React"ten önce denenmesi gerekir; aksi halde
 * "Native" artık olarak kalır.
 */
const FOLDED_ENTRIES: Array<[string, string]> = [...SKILL_DICTIONARY]
  .map((term) => [foldPreservingLength(term), term] as [string, string])
  .filter(([key]) => key.length >= 2)
  .sort((left, right) => right[0].length - left[0].length);

/**
 * Bir metnin içinden becerileri açgözlü olarak çıkarır.
 *
 * PDF metin çıkarımında "pill/etiket" düzeniyle çizilmiş beceriler arasına
 * boşluk KARAKTERİ girmez ve tek bir blok oluşur:
 *   "ReactNext.jsTypeScriptJavaScriptReduxTailwind CSSHTMLCSSGitREST"
 *
 * Metin soldan sağa taranır; bilinen terimler ayrılır, sözlükte olmayan
 * aradaki parçalar da özgün yazımıyla korunur ("Export Marketing" gibi).
 *
 * CamelCase'ten bölmek yerine sözlük kullanılır; çünkü "TypeScript",
 * "JavaScript", "GraphQL", "PostgreSQL" gibi meşru adlar CamelCase kuralıyla
 * yanlışlıkla ikiye bölünür ("Type|Script").
 */
export function extractKnownSkills(text: string, options: { keepUnknown?: boolean } = {}): string[] {
  const folded = foldPreservingLength(text);

  if (!folded.trim()) {
    return [];
  }

  const found: string[] = [];
  let cursor = 0;
  let leftoverStart = 0;

  const flushLeftover = (end: number) => {
    if (!options.keepUnknown) {
      return;
    }

    const leftover = text.slice(leftoverStart, end).trim();
    // 4 karakterden kısa artıklar bağlaç/gürültüdür ("ve", "ile").
    if (leftover.length >= 4 && /[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(leftover)) {
      found.push(leftover);
    }
  };

  while (cursor < folded.length) {
    const match = FOLDED_ENTRIES.find(([key]) => folded.startsWith(key, cursor));

    if (match) {
      flushLeftover(cursor);
      found.push(match[1]);
      cursor += match[0].length;
      leftoverStart = cursor;
      continue;
    }

    cursor += 1;
  }

  flushLeftover(folded.length);

  return dedupePreservingOrder(found);
}

/**
 * Bir beceri parçasını, gerekiyorsa, alt becerilere böler.
 *
 * Uzun parçalar (40+ karakter) bölünmezse üst katmandaki uzunluk filtresine
 * takılıp TAMAMEN kaybolur — bu yüzden onlarda bölmeyi her hâlükârda deneriz.
 */
export function splitSkillSegment(value: string): string[] {
  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  const isOverlong = trimmed.length > 40;

  if (!isOverlong && !looksLikeRunOnSkillBlock(trimmed)) {
    return [trimmed];
  }

  const parts = extractKnownSkills(trimmed, { keepUnknown: isOverlong });
  return parts.length >= 2 ? parts : [trimmed];
}

/**
 * Bir metin parçasının, birbirine yapışmış beceri bloğu olup olmadığını tahmin
 * eder. Üç koşul birlikte aranır:
 *
 *  1. Zaten bir ayırıcı içermiyor (içeriyorsa normal bölme yeter).
 *  2. İçinde en az iki bilinen beceri geçiyor.
 *  3. Bulunan beceriler metnin büyük kısmını kaplıyor.
 *
 * Üçüncü koşul, "React kullanarak ölçeklenebilir arayüzler geliştirdim" gibi
 * normal cümlelerin yanlışlıkla parçalanmasını engeller: orada bilinen terimler
 * metnin küçük bir bölümünü kaplar.
 */
export function looksLikeRunOnSkillBlock(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.length < 8 || /[,;|•·]/.test(trimmed)) {
    return false;
  }

  // En kesin sinyal: bilinen bir terim, araya boşluk girmeden büyük harfle
  // devam ediyor ("CRMUluslararası", "HTMLCSSGit"). Meşru CamelCase adlar
  // (JavaScript, GraphQL) bunu tetiklemez, çünkü açgözlü eşleştirme önce en
  // uzun terimi tüketir: "JavaScript" bir bütün olarak eşleşir, "Java" değil.
  if (hasConcatenatedBoundary(trimmed)) {
    return true;
  }

  const found = extractKnownSkills(trimmed);

  if (found.length < 2) {
    return false;
  }

  const normalizedLength = normalizeComparable(trimmed).replace(/\s/g, "").length;
  const coveredLength = found.reduce((sum, skill) => sum + normalizeComparable(skill).replace(/\s/g, "").length, 0);

  return normalizedLength > 0 && coveredLength / normalizedLength >= 0.7;
}

/** Bilinen bir terimin hemen ardından boşluksuz büyük harf geliyor mu? */
function hasConcatenatedBoundary(text: string): boolean {
  const folded = foldPreservingLength(text);
  let cursor = 0;

  while (cursor < folded.length) {
    const match = FOLDED_ENTRIES.find(([key]) => folded.startsWith(key, cursor));

    if (!match) {
      cursor += 1;
      continue;
    }

    const nextIndex = cursor + match[0].length;
    const nextChar = text[nextIndex];

    if (nextChar && /[A-ZÇĞİÖŞÜ]/.test(nextChar)) {
      return true;
    }

    cursor = nextIndex;
  }

  return false;
}

function dedupePreservingOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of items) {
    const key = normalizeComparable(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }

  return out;
}
