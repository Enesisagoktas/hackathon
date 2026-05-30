import fs from "fs/promises";
import path from "path";

/**
 * Generates ready-to-upload sample CV PDFs (for manual testing) using the
 * already-installed Puppeteer to render HTML → PDF. Output: samples/*.pdf
 *   npm run make:cv
 */

const CVS: Array<{ file: string; title: string; html: string }> = [
  {
    file: "ornek-cv-frontend.pdf",
    title: "Frontend Developer",
    html: cvHtml({
      name: "Ahmet Yılmaz",
      role: "Frontend Developer",
      contact: "ahmet.yilmaz@example.com · +90 532 000 00 00 · İstanbul",
      summary:
        "4 yıl deneyimli Frontend Developer. React, Next.js ve TypeScript ile ölçeklenebilir, performanslı web uygulamaları geliştiriyorum. REST/GraphQL API entegrasyonları, design system ve test pratiklerine hâkimim.",
      experience: [
        {
          title: "Senior Frontend Developer — Vega Teknoloji",
          period: "2022 - günümüz · İstanbul",
          points: [
            "React, Next.js, Redux ve Tailwind CSS ile e-ticaret arayüzünü yeniden geliştirdim; sayfa yüklenme süresini %35 azalttım.",
            "REST API entegrasyonları ve Jest ile birim testleri yazdım; kod kapsamını %80'e çıkardım.",
            "3 kişilik frontend ekibine mentorluk yaptım."
          ]
        },
        {
          title: "Frontend Developer — Kovan Studio",
          period: "2020 - 2022 · İstanbul",
          points: [
            "TypeScript ve GraphQL ile SaaS ürün arayüzleri geliştirdim.",
            "Design system ve yeniden kullanılabilir bileşen kütüphanesi kurdum."
          ]
        }
      ],
      skills: ["React", "Next.js", "TypeScript", "JavaScript", "Redux", "Tailwind CSS", "HTML", "CSS", "Git", "REST", "GraphQL", "Jest"],
      education: "Bilgisayar Mühendisliği, Lisans — Yıldız Teknik Üniversitesi (2016 - 2020)",
      languages: "Türkçe (ana dil), İngilizce (ileri)"
    })
  },
  {
    file: "ornek-cv-ihracat.pdf",
    title: "İhracat Pazarlama Uzmanı",
    html: cvHtml({
      name: "Elif Demir",
      role: "İhracat Pazarlama Uzmanı / Export Marketing Specialist",
      contact: "elif.demir@example.com · +90 533 111 11 11 · İzmir",
      summary:
        "6 yıl deneyimli İhracat ve Dış Ticaret Pazarlama Uzmanı. Yurt dışı müşteri ilişkileri, uluslararası fuar organizasyonları ve pazar araştırması konularında uzmanım. İleri seviye İngilizce ve orta seviye Almanca.",
      experience: [
        {
          title: "İhracat Pazarlama Uzmanı — Ege İhracat A.Ş.",
          period: "2021 - günümüz · İzmir",
          points: [
            "12 ülkede yeni distribütör ağı kurarak ihracat cirosunu %40 artırdım.",
            "Uluslararası fuarlarda (Almanya, BAE) firma temsilciliği yaptım.",
            "Incoterms ve akreditif (LC) süreçlerini yönettim."
          ]
        },
        {
          title: "Dış Ticaret Uzmanı — Marmara Lojistik",
          period: "2018 - 2021 · Kocaeli",
          points: [
            "İthalat-ihracat operasyonları ve gümrük müşaviri koordinasyonunu yürüttüm.",
            "B2B uluslararası pazarlama kampanyaları planladım."
          ]
        }
      ],
      skills: ["İhracat", "Dış Ticaret", "Export Marketing", "B2B", "Incoterms", "Akreditif", "Pazar Araştırması", "Müşteri İlişkileri", "CRM", "Uluslararası Pazarlama"],
      education: "Uluslararası İlişkiler, Lisans — Dokuz Eylül Üniversitesi (2012 - 2016)",
      languages: "Türkçe (ana dil), İngilizce (ileri), Almanca (orta)"
    })
  }
];

async function run() {
  let puppeteer: typeof import("puppeteer");
  try {
    puppeteer = await import("puppeteer");
  } catch {
    console.error("[make:cv] Puppeteer bulunamadı. `npm install` çalıştırın.");
    process.exitCode = 1;
    return;
  }

  const outDir = path.resolve(process.cwd(), "samples");
  await fs.mkdir(outDir, { recursive: true });

  const browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    for (const cv of CVS) {
      const page = await browser.newPage();
      await page.setContent(cv.html, { waitUntil: "load" });
      await page.pdf({ path: path.join(outDir, cv.file), format: "A4", printBackground: true, margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" } });
      await page.close();
      console.log(`[make:cv] Oluşturuldu: samples/${cv.file} (${cv.title})`);
    }
  } finally {
    await browser.close();
  }

  console.log("[make:cv] Tamamlandı. PDF'leri uygulamada yükleyerek test edebilirsiniz.");
}

function cvHtml(data: {
  name: string;
  role: string;
  contact: string;
  summary: string;
  experience: Array<{ title: string; period: string; points: string[] }>;
  skills: string[];
  education: string;
  languages: string;
}): string {
  const experience = data.experience
    .map(
      (job) => `
      <div class="job">
        <div class="job-title">${job.title}</div>
        <div class="job-period">${job.period}</div>
        <ul>${job.points.map((point) => `<li>${point}</li>`).join("")}</ul>
      </div>`
    )
    .join("");

  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; font-size: 12px; line-height: 1.55; }
    h1 { font-size: 24px; margin: 0; color: #0f172a; }
    .role { color: #0d9488; font-weight: 600; margin: 2px 0 6px; }
    .contact { color: #475569; font-size: 11px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #0d9488; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; margin: 18px 0 8px; }
    .job { margin-bottom: 10px; }
    .job-title { font-weight: 700; }
    .job-period { color: #64748b; font-size: 11px; margin-bottom: 3px; }
    ul { margin: 4px 0 0; padding-left: 18px; }
    li { margin-bottom: 2px; }
    .skills span { display: inline-block; background: #f0fdfa; border: 1px solid #99f6e4; color: #115e59; border-radius: 999px; padding: 2px 9px; margin: 2px 4px 2px 0; font-size: 11px; }
  </style></head><body>
    <h1>${data.name}</h1>
    <div class="role">${data.role}</div>
    <div class="contact">${data.contact}</div>
    <h2>Profil</h2>
    <p>${data.summary}</p>
    <h2>Deneyim</h2>
    ${experience}
    <h2>Beceriler</h2>
    <div class="skills">${data.skills.map((skill) => `<span>${skill}</span>`).join("")}</div>
    <h2>Eğitim</h2>
    <p>${data.education}</p>
    <h2>Diller</h2>
    <p>${data.languages}</p>
  </body></html>`;
}

run();
