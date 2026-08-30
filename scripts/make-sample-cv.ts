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
    file: "ornek-cv-hemsire.pdf",
    title: "Hemşire",
    html: cvHtml({
      name: "Fatma Demir",
      role: "Hemşire",
      contact: "fatma.demir@example.com · +90 533 111 22 33 · İstanbul",
      summary:
        "4 yıl deneyimli hemşire. Yoğun bakım ve dahiliye servislerinde hasta bakımı, ilaç uygulama ve enfeksiyon kontrolü alanlarında görev aldım. Hasta ve yakını iletişiminde deneyimliyim.",
      experience: [
        {
          title: "Servis Hemşiresi — Özel Anadolu Hastanesi",
          period: "2023 - günümüz · İstanbul",
          points: [
            "Dahiliye servisinde günlük 20+ hastanın bakım ve ilaç takibini yürüttüm.",
            "Enfeksiyon kontrol komitesinde görev aldım; el hijyeni uyumunu artıran eğitimler verdim."
          ]
        },
        {
          title: "Yoğun Bakım Hemşiresi — Devlet Hastanesi",
          period: "2021 - 2023 · Ankara",
          points: [
            "3. seviye yoğun bakımda ventilatördeki hastaların bakımını üstlendim.",
            "Acil müdahale ekibinde CPR sertifikalı üye olarak çalıştım."
          ]
        }
      ],
      skills: ["Hasta bakımı", "Yoğun bakım", "İlaç uygulama", "Enfeksiyon kontrolü", "CPR", "Hasta kayıt sistemleri", "Vital takibi"],
      education: "Hemşirelik, Lisans — İstanbul Üniversitesi (2017 - 2021)",
      languages: "Türkçe (ana dil), İngilizce (orta)"
    })
  },
  {
    file: "ornek-cv-garson.pdf",
    title: "Garson",
    html: cvHtml({
      name: "Murat Kaya",
      role: "Garson",
      contact: "murat.kaya@example.com · +90 534 222 33 44 · İstanbul",
      summary:
        "3 yıl deneyimli servis elemanı. Yoğun restoran ve kafe ortamlarında sipariş alma, servis ve kasa/adisyon takibi yaptım. Müşteri memnuniyeti odaklı çalışırım.",
      experience: [
        {
          title: "Garson — Lezzet Durağı Restoran",
          period: "2024 - günümüz · İstanbul Kadıköy",
          points: [
            "Günlük 100+ misafirin sipariş ve servisini yürüttüm.",
            "Adisyon ve kasa kapanışlarında sorumluluk aldım."
          ]
        },
        {
          title: "Servis Elemanı — Keyif Kafe",
          period: "2022 - 2024 · İstanbul",
          points: [
            "Kahvaltı ve öğle servisinde masa düzeni ve sipariş akışını yönettim.",
            "Yeni başlayan iki servis elemanına işe alıştırma eğitimi verdim."
          ]
        }
      ],
      skills: ["Servis", "Sipariş alma", "Adisyon", "Müşteri ilişkileri", "Kasa", "Takım çalışması", "Hijyen"],
      education: "Lise — Kadıköy Anadolu Lisesi (2018 - 2022)",
      languages: "Türkçe (ana dil), İngilizce (temel)"
    })
  },
  {
    file: "ornek-cv-muhasebe.pdf",
    title: "Muhasebe Elemanı",
    html: cvHtml({
      name: "Zeynep Arslan",
      role: "Muhasebe Elemanı",
      contact: "zeynep.arslan@example.com · +90 535 333 44 55 · İstanbul",
      summary:
        "5 yıl deneyimli muhasebe elemanı. Genel muhasebe, e-fatura/e-arşiv süreçleri, Logo Tiger kullanımı ve KDV/muhtasar beyannameleri konusunda deneyimliyim.",
      experience: [
        {
          title: "Muhasebe Elemanı — Kardelen Gıda San. Tic. Ltd.",
          period: "2022 - günümüz · İstanbul",
          points: [
            "Aylık 500+ e-fatura kaydını Logo Tiger üzerinden işledim.",
            "KDV ve muhtasar beyannamelerinin hazırlık süreçlerini yürüttüm.",
            "Cari hesap mutabakatlarını aylık düzenle tamamladım."
          ]
        },
        {
          title: "Ön Muhasebe Elemanı — Yıldız Ticaret",
          period: "2019 - 2022 · İstanbul",
          points: [
            "Fatura kesimi, tahsilat takibi ve banka mutabakatlarını yaptım.",
            "Excel ile haftalık nakit akış raporları hazırladım."
          ]
        }
      ],
      skills: ["Genel muhasebe", "Logo Tiger", "E-fatura", "Beyanname", "Excel", "Cari hesap", "Mutabakat"],
      education: "Muhasebe ve Vergi Uygulamaları, Ön Lisans — Anadolu Üniversitesi (2017 - 2019)",
      languages: "Türkçe (ana dil)"
    })
  },
  {
    file: "ornek-cv-ogretmen.pdf",
    title: "İngilizce Öğretmeni",
    html: cvHtml({
      name: "Elif Şahin",
      role: "İngilizce Öğretmeni",
      contact: "elif.sahin@example.com · +90 536 444 55 66 · İzmir",
      summary:
        "Yeni mezun İngilizce öğretmeni. Staj döneminde ortaokul seviyesinde ders planlama ve sınıf yönetimi deneyimi kazandım; özel ders vererek farklı seviyelerde öğrencilerle çalıştım.",
      experience: [
        {
          title: "Stajyer Öğretmen — İzmir Atatürk Ortaokulu",
          period: "2025 - 2026 · İzmir",
          points: [
            "Haftada 12 saat İngilizce dersini gözetim altında planlayıp işledim.",
            "Ölçme-değerlendirme araçları hazırladım ve veli görüşmelerine katıldım."
          ]
        },
        {
          title: "Özel Ders Öğretmeni — Serbest",
          period: "2023 - günümüz · İzmir",
          points: [
            "İlkokul ve lise seviyesinde 10+ öğrenciye birebir İngilizce dersi verdim.",
            "YDS/YDT hazırlık programları oluşturdum."
          ]
        }
      ],
      skills: ["Ders planlama", "Sınıf yönetimi", "Ölçme değerlendirme", "İngilizce", "İletişim", "Materyal geliştirme"],
      education: "İngilizce Öğretmenliği, Lisans — Dokuz Eylül Üniversitesi (2022 - 2026)",
      languages: "Türkçe (ana dil), İngilizce (ileri - C1)"
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
