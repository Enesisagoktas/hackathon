import type { TailoredCv } from "@/lib/cv/types";

/**
 * Uyarlanmış CV'yi tek dosyalık, yazdırmaya hazır HTML'e çevirir.
 * Hem tarayıcı önizlemesi hem de PDF üretimi (puppeteer) bu çıktıyı kullanır.
 *
 * ATS notu: tablo, çok sütunlu yerleşim ve ikon kullanılmaz; metin akışı
 * tek sütun ve seçilebilir haldedir, böylece ilan sistemleri CV'yi okuyabilir.
 */
export function renderTailoredCvHtml(cv: TailoredCv): string {
  const contactLine = [cv.contact.email, cv.contact.phone, cv.contact.location, ...cv.contact.links]
    .filter((part): part is string => Boolean(part))
    .map(escapeHtml)
    .join(" &nbsp;·&nbsp; ");

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>${escapeHtml(cv.contact.fullName || "CV")} — ${escapeHtml(cv.headline)}</title>
<style>
  @page { size: A4; margin: 14mm 14mm 14mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.45;
    color: #1f2933;
    margin: 0;
  }
  header { border-bottom: 2px solid #0f766e; padding-bottom: 10px; margin-bottom: 14px; }
  h1 { font-size: 20pt; margin: 0 0 2px; letter-spacing: -0.01em; color: #0b1220; }
  .headline { font-size: 11.5pt; font-weight: 600; color: #0f766e; margin: 0 0 6px; }
  .contact { font-size: 9pt; color: #52606d; }
  h2 {
    font-size: 10pt; text-transform: uppercase; letter-spacing: 0.08em;
    color: #0f766e; margin: 16px 0 6px; padding-bottom: 3px;
    border-bottom: 1px solid #d9e2ec;
  }
  section { page-break-inside: auto; }
  p { margin: 0 0 6px; }
  ul { margin: 4px 0 0; padding-left: 16px; }
  li { margin-bottom: 3px; }
  .entry { margin-bottom: 11px; page-break-inside: avoid; }
  .entry-title { font-weight: 600; color: #0b1220; }
  /* ATS notu: başlık ve tarih ESKİDEN aynı satırda flex space-between ile
     duruyordu. Bu düzen görsel boşluk üretir ama PDF metnine boşluk KARAKTERİ
     koymaz; ilan sistemleri "Frontend Developer2020 - 2022" okur. Bu yüzden
     tarih, şirket ve konumla birlikte gerçek " · " ayırıcılı alt satıra alındı. */
  .entry-sub { font-size: 9.5pt; color: #52606d; margin: 1px 0 3px; }
  /* Aynı sebeple beceriler de "pill" yerine ayırıcılı satır içi metin. */
  .skills-line { font-size: 10pt; color: #0f766e; font-weight: 600; }
  .skills-line.muted { color: #3e4c59; font-weight: 400; font-size: 9.5pt; }
  .group { margin-bottom: 6px; }
  .group-title { font-size: 9pt; font-weight: 600; color: #616e7c; margin-bottom: 3px; }
  .inline-list { font-size: 9.5pt; color: #3e4c59; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(cv.contact.fullName || "İsimsiz Aday")}</h1>
  <p class="headline">${escapeHtml(cv.headline)}</p>
  ${contactLine ? `<div class="contact">${contactLine}</div>` : ""}
</header>

${cv.summary ? `<section><h2>Profesyonel Özet</h2><p>${escapeHtml(cv.summary)}</p></section>` : ""}

${
  cv.highlightedSkills.length
    ? `<section>
  <h2>İlanla Eşleşen Beceriler</h2>
  <p class="skills-line">${cv.highlightedSkills.map(escapeHtml).join(" &middot; ")}</p>
</section>`
    : ""
}

${
  cv.experience.length
    ? `<section>
  <h2>İş Deneyimi</h2>
  ${cv.experience.map(renderExperience).join("")}
</section>`
    : ""
}

${
  cv.projects.length
    ? `<section>
  <h2>Projeler</h2>
  ${cv.projects
    .map(
      (project) => `<div class="entry">
    <div class="entry-title">${escapeHtml(project.name)}</div>
    ${project.detail ? `<div class="entry-sub">${escapeHtml(project.detail)}</div>` : ""}
    ${project.skills.length ? `<div class="inline-list">${escapeHtml(project.skills.join(" · "))}</div>` : ""}
  </div>`
    )
    .join("")}
</section>`
    : ""
}

${
  cv.education.length
    ? `<section>
  <h2>Eğitim</h2>
  ${cv.education
    .map(
      (item) => `<div class="entry">
    <div class="entry-title">${escapeHtml(item.degree)}</div>
    ${
      [item.school, item.detail, item.period].filter(Boolean).length
        ? `<div class="entry-sub">${escapeHtml([item.school, item.detail, item.period].filter(Boolean).join(" · "))}</div>`
        : ""
    }
  </div>`
    )
    .join("")}
</section>`
    : ""
}

${
  cv.adjacentSkills.length || cv.skillGroups.length
    ? `<section>
  <h2>Diğer Yetkinlikler</h2>
  ${
    cv.adjacentSkills.length
      ? `<div class="group">
    <div class="group-title">İlave güçlü yönler</div>
    <p class="skills-line muted">${cv.adjacentSkills.map(escapeHtml).join(" &middot; ")}</p>
  </div>`
      : ""
  }
  ${cv.skillGroups
    .map(
      (group) => `<div class="group">
    <div class="group-title">${escapeHtml(group.title)}</div>
    <div class="inline-list">${escapeHtml(group.skills.join(" · "))}</div>
  </div>`
    )
    .join("")}
</section>`
    : ""
}

${
  cv.certifications.length
    ? `<section>
  <h2>Sertifikalar</h2>
  <ul>${cv.certifications.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
</section>`
    : ""
}

${
  cv.languages.length
    ? `<section>
  <h2>Diller</h2>
  <div class="inline-list">${cv.languages
    .map((item) => escapeHtml(item.level ? `${item.name} (${item.level})` : item.name))
    .join(" &nbsp;·&nbsp; ")}</div>
</section>`
    : ""
}
</body>
</html>`;
}

function renderExperience(entry: TailoredCv["experience"][number]): string {
  // Şirket, konum ve dönem tek alt satırda, aralarında gerçek " · " ayırıcısıyla.
  const subLine = [entry.company, entry.location, entry.period].filter(Boolean).join(" · ");

  return `<div class="entry">
    <div class="entry-title">${escapeHtml(entry.role)}</div>
    ${subLine ? `<div class="entry-sub">${escapeHtml(subLine)}</div>` : ""}
    ${entry.bullets.length ? `<ul>${entry.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>` : ""}
    ${entry.skills.length ? `<div class="inline-list">${escapeHtml(entry.skills.join(" · "))}</div>` : ""}
  </div>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
