import type { TailoredCv } from "@/lib/cv/types";

/**
 * Uyarlanmış CV'yi yazdırmaya hazır HTML'e çevirir; PDF üretimi (puppeteer)
 * ve arayüz önizlemesi bu çıktıyı kullanır.
 *
 * Tasarım: koyu yeşil başlık bandı + iki sütunlu gövde (solda deneyim/eğitim,
 * sağda beceri paneli). Amaç "şablondan çıkmış" değil "tasarlanmış" görünen
 * bir CV.
 *
 * ATS notları (ilan sistemleri PDF'ten metin çıkarır):
 * - Görsel boşluk yetmez; her ayrımın altında GERÇEK bir ayırıcı karakter
 *   vardır (" · ", satır sonu). Aksi halde "TypeScriptReact" gibi bitişik
 *   metin çıkar.
 * - DOM sırası okuma sırasıdır: başlık → ana sütun → yan panel. İki sütun
 *   flex ile çizilir ama metin akışı bozulmaz.
 */
export function renderTailoredCvHtml(cv: TailoredCv): string {
  const contactParts = [cv.contact.email, cv.contact.phone, cv.contact.location, ...cv.contact.links].filter(
    (part): part is string => Boolean(part)
  );

  const initials = buildInitials(cv.contact.fullName);

  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>${escapeHtml(cv.contact.fullName || "CV")} — ${escapeHtml(cv.headline)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 9.8pt;
    line-height: 1.5;
    color: #23303d;
    background: #ffffff;
    /* Yan panel arka planı içerik kısa kalsa da sayfa sonuna uzasın. */
    min-height: 296mm;
    display: flex;
    flex-direction: column;
  }

  /* ── Başlık bandı ─────────────────────────────────────────────────── */
  .masthead {
    background: linear-gradient(120deg, #0b3d3a 0%, #0f766e 70%, #14887d 100%);
    color: #ffffff;
    padding: 26px 34px 22px;
  }
  .masthead-row { display: flex; align-items: center; gap: 18px; }
  .avatar {
    width: 58px; height: 58px; border-radius: 50%;
    background: rgba(255, 255, 255, 0.14);
    border: 2px solid rgba(255, 255, 255, 0.45);
    display: flex; align-items: center; justify-content: center;
    font-size: 20pt; font-weight: 600; letter-spacing: 0.02em;
    flex-shrink: 0;
  }
  .masthead h1 { font-size: 21pt; font-weight: 700; letter-spacing: -0.01em; }
  .masthead .headline { margin-top: 2px; font-size: 11.5pt; font-weight: 400; color: #b8f0e6; }
  .masthead .contact {
    margin-top: 10px; font-size: 8.6pt; color: #d6efeb;
    border-top: 1px solid rgba(255, 255, 255, 0.22); padding-top: 8px;
  }

  /* ── Gövde: iki sütun ─────────────────────────────────────────────── */
  .sheet { display: flex; align-items: stretch; flex: 1; }
  .main { flex: 1 1 66%; padding: 20px 24px 28px 34px; min-width: 0; }
  .side {
    flex: 0 0 34%;
    background: #f0faf8;
    border-left: 3px solid #0f766e;
    padding: 20px 22px 28px;
    min-width: 0;
  }

  h2 {
    font-size: 10pt; text-transform: uppercase; letter-spacing: 0.1em;
    color: #0f766e; font-weight: 700;
    margin: 18px 0 8px; padding-bottom: 4px;
    border-bottom: 2px solid #99e2d8;
  }
  h2:first-child { margin-top: 0; }
  .side h2 { border-bottom-color: #7fd4c8; }

  p { margin-bottom: 6px; }

  /* Deneyim / eğitim kayıtları */
  .entry { margin-bottom: 12px; page-break-inside: avoid; }
  .entry-title { font-weight: 700; font-size: 10.4pt; color: #14222e; }
  .entry-sub { font-size: 9pt; color: #0f766e; font-weight: 600; margin: 1px 0 4px; }
  .entry ul { padding-left: 14px; }
  .entry li { margin-bottom: 2.5px; }
  .entry-skills { font-size: 8.6pt; color: #5b6b7a; font-style: italic; margin-top: 3px; }

  /* Yan panel becerileri: satır başına bir beceri (ATS: satır sonu = ayırıcı) */
  .skill-item {
    display: block;
    background: #ffffff;
    border: 1px solid #b9e7df;
    border-left: 3px solid #0f766e;
    border-radius: 4px;
    padding: 3.5px 9px;
    margin-bottom: 5px;
    font-size: 9pt;
    font-weight: 600;
    color: #114b45;
    page-break-inside: avoid;
  }
  .skill-item.plain {
    font-weight: 400;
    border-left-color: #9fb6b1;
    color: #3d4f5c;
  }
  .side .list-line { font-size: 9pt; margin-bottom: 4px; }
  .side .muted { color: #5b6b7a; font-size: 8.6pt; margin-bottom: 8px; }
</style>
</head>
<body>

<header class="masthead">
  <div class="masthead-row">
    ${initials ? `<div class="avatar">${escapeHtml(initials)}</div>` : ""}
    <div>
      <h1>${escapeHtml(cv.contact.fullName || "İsimsiz Aday")}</h1>
      <div class="headline">${escapeHtml(cv.headline)}</div>
    </div>
  </div>
  ${contactParts.length ? `<div class="contact">${contactParts.map(escapeHtml).join(" &nbsp;·&nbsp; ")}</div>` : ""}
</header>

<div class="sheet">
  <main class="main">
    ${cv.summary ? `<h2>Profesyonel Özet</h2><p>${escapeHtml(cv.summary)}</p>` : ""}

    ${cv.experience.length ? `<h2>İş Deneyimi</h2>${cv.experience.map(renderExperience).join("")}` : ""}

    ${
      cv.projects.length
        ? `<h2>Projeler</h2>${cv.projects
            .map(
              (project) => `<div class="entry">
      <div class="entry-title">${escapeHtml(project.name)}</div>
      ${project.detail ? `<p>${escapeHtml(project.detail)}</p>` : ""}
      ${project.skills.length ? `<div class="entry-skills">${escapeHtml(project.skills.join(" · "))}</div>` : ""}
    </div>`
            )
            .join("")}`
        : ""
    }

    ${
      cv.education.length
        ? `<h2>Eğitim</h2>${cv.education
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
            .join("")}`
        : ""
    }
  </main>

  <aside class="side">
    ${
      cv.highlightedSkills.length
        ? `<h2>Öne Çıkan Beceriler</h2>
    <div class="muted">İlanın aradığı ve adayda bulunan yetkinlikler</div>
    ${cv.highlightedSkills.map((skill) => `<span class="skill-item">${escapeHtml(skill)}</span>`).join("\n    ")}`
        : ""
    }

    ${
      cv.adjacentSkills.length
        ? `<h2>Diğer Yetkinlikler</h2>
    ${cv.adjacentSkills.map((skill) => `<span class="skill-item plain">${escapeHtml(skill)}</span>`).join("\n    ")}`
        : ""
    }

    ${
      cv.skillGroups.length
        ? cv.skillGroups
            .map(
              (group) => `<h2>${escapeHtml(group.title)}</h2>
    <div class="list-line">${escapeHtml(group.skills.join(" · "))}</div>`
            )
            .join("\n    ")
        : ""
    }

    ${
      cv.languages.length
        ? `<h2>Diller</h2>
    ${cv.languages
      .map((item) => `<div class="list-line">${escapeHtml(item.level ? `${item.name} — ${item.level}` : item.name)}</div>`)
      .join("\n    ")}`
        : ""
    }

    ${
      cv.certifications.length
        ? `<h2>Sertifikalar</h2>
    ${cv.certifications.map((item) => `<div class="list-line">${escapeHtml(item)}</div>`).join("\n    ")}`
        : ""
    }
  </aside>
</div>

</body>
</html>`;
}

function renderExperience(entry: TailoredCv["experience"][number]): string {
  // Şirket, konum ve dönem tek alt satırda, gerçek " · " ayırıcılarıyla.
  const subLine = [entry.company, entry.location, entry.period].filter(Boolean).join(" · ");

  return `<div class="entry">
    <div class="entry-title">${escapeHtml(entry.role)}</div>
    ${subLine ? `<div class="entry-sub">${escapeHtml(subLine)}</div>` : ""}
    ${entry.bullets.length ? `<ul>${entry.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>` : ""}
    ${entry.skills.length ? `<div class="entry-skills">${escapeHtml(entry.skills.join(" · "))}</div>` : ""}
  </div>`;
}

/** Ad soyaddan avatar baş harfleri ("Ahmet Yılmaz" → "AY"). */
function buildInitials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);

  if (!words.length) {
    return "";
  }

  const first = words[0][0] ?? "";
  const last = words.length > 1 ? words[words.length - 1][0] ?? "" : "";

  return (first + last).toLocaleUpperCase("tr-TR");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
