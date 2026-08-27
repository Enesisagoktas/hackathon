import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { renderTailoredCvHtml } from "@/lib/cv/render-html";
import type { TailoredCv } from "@/lib/cv/types";

/**
 * Uyarlanmış CV'yi PDF ve DOCX dosyalarına yazar.
 *
 * PDF: puppeteer (zaten crawler için bağımlılık) — Türkçe karakterler ve
 * stil sorunsuz çalışır. DOCX: `docx` paketi — kullanıcı sonradan elle
 * düzenleyebilsin diye gerçek paragraf/başlık yapısı üretilir.
 */

const STORAGE_ROOT = process.env.APPLICATION_FILES_DIR ?? path.join(process.cwd(), "storage", "applications");

export type RenderedCvFiles = {
  pdfPath: string;
  docxPath: string;
};

export async function renderTailoredCvFiles(cv: TailoredCv, applicationId: number): Promise<RenderedCvFiles> {
  const dir = path.join(STORAGE_ROOT, String(applicationId));
  await mkdir(dir, { recursive: true });

  const baseName = buildFileBaseName(cv);
  const pdfPath = path.join(dir, `${baseName}.pdf`);
  const docxPath = path.join(dir, `${baseName}.docx`);

  // Biri patlarsa diğeri yine üretilsin diye ayrı ayrı denenir.
  const [pdfResult, docxResult] = await Promise.allSettled([
    renderPdf(cv, pdfPath),
    renderDocx(cv, docxPath)
  ]);

  if (pdfResult.status === "rejected" && docxResult.status === "rejected") {
    throw new Error(
      `CV dosyaları üretilemedi. PDF: ${errorText(pdfResult.reason)} | DOCX: ${errorText(docxResult.reason)}`
    );
  }

  if (pdfResult.status === "rejected") {
    console.error("[render-files] PDF üretilemedi:", errorText(pdfResult.reason));
  }

  if (docxResult.status === "rejected") {
    console.error("[render-files] DOCX üretilemedi:", errorText(docxResult.reason));
  }

  return {
    pdfPath: pdfResult.status === "fulfilled" ? pdfPath : "",
    docxPath: docxResult.status === "fulfilled" ? docxPath : ""
  };
}

/** Dosya adı: "Ada-Lovelace-Frontend-Developer-CV" */
export function buildFileBaseName(cv: TailoredCv): string {
  const parts = [cv.contact.fullName || "CV", cv.headline].filter(Boolean).join("-");

  const slug = parts
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u")
    .replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${slug || "uyarlanmis-cv"}-cv`;
}

// ─── PDF ──────────────────────────────────────────────────────────────────

async function renderPdf(cv: TailoredCv, outputPath: string): Promise<void> {
  const puppeteer = (await import("puppeteer")).default;
  const html = renderTailoredCvHtml(cv);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  });

  try {
    const page = await browser.newPage();
    // Dış kaynak yok; networkidle beklemeye gerek kalmadan render biter.
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", right: "14mm", bottom: "14mm", left: "14mm" }
    });
  } finally {
    await browser.close().catch(() => undefined);
  }
}

// ─── DOCX ─────────────────────────────────────────────────────────────────

async function renderDocx(cv: TailoredCv, outputPath: string): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = await import("docx");

  const heading = (text: string) =>
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 80 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "D9E2EC", space: 2 } },
      children: [new TextRun({ text: text.toLocaleUpperCase("tr-TR"), bold: true, size: 20, color: "0F766E" })]
    });

  const body = (text: string, options: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) =>
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text, size: options.size ?? 21, bold: options.bold, italics: options.italics, color: options.color })]
    });

  const bullet = (text: string) =>
    new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text, size: 21 })] });

  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 40 },
      children: [new TextRun({ text: cv.contact.fullName || "İsimsiz Aday", bold: true, size: 40, color: "0B1220" })]
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: cv.headline, bold: true, size: 23, color: "0F766E" })]
    })
  ];

  const contactLine = [cv.contact.email, cv.contact.phone, cv.contact.location, ...cv.contact.links]
    .filter(Boolean)
    .join(" · ");

  if (contactLine) {
    children.push(body(contactLine, { size: 18, color: "52606D" }));
  }

  if (cv.summary) {
    children.push(heading("Profesyonel Özet"), body(cv.summary));
  }

  if (cv.highlightedSkills.length) {
    children.push(heading("İlanla Eşleşen Beceriler"), body(cv.highlightedSkills.join(" · "), { bold: true }));
  }

  if (cv.experience.length) {
    children.push(heading("İş Deneyimi"));

    for (const entry of cv.experience) {
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 20 },
          children: [
            new TextRun({ text: entry.role, bold: true, size: 22 }),
            entry.period ? new TextRun({ text: `   ${entry.period}`, size: 18, color: "616E7C" }) : new TextRun({ text: "" })
          ]
        })
      );

      const sub = [entry.company, entry.location].filter(Boolean).join(" · ");
      if (sub) {
        children.push(body(sub, { size: 19, color: "52606D" }));
      }

      for (const item of entry.bullets) {
        children.push(bullet(item));
      }

      if (entry.skills.length) {
        children.push(body(entry.skills.join(" · "), { size: 18, italics: true, color: "3E4C59" }));
      }
    }
  }

  if (cv.projects.length) {
    children.push(heading("Projeler"));
    for (const project of cv.projects) {
      children.push(body(project.name, { bold: true }));
      if (project.detail) children.push(body(project.detail, { size: 19 }));
    }
  }

  if (cv.education.length) {
    children.push(heading("Eğitim"));
    for (const item of cv.education) {
      children.push(body([item.degree, item.period].filter(Boolean).join("   "), { bold: true }));
      const sub = [item.school, item.detail].filter(Boolean).join(" · ");
      if (sub) children.push(body(sub, { size: 19, color: "52606D" }));
    }
  }

  if (cv.adjacentSkills.length || cv.skillGroups.length) {
    children.push(heading("Diğer Yetkinlikler"));
    if (cv.adjacentSkills.length) {
      children.push(body(`İlave güçlü yönler: ${cv.adjacentSkills.join(" · ")}`, { size: 19 }));
    }
    for (const group of cv.skillGroups) {
      children.push(body(`${group.title}: ${group.skills.join(" · ")}`, { size: 19 }));
    }
  }

  if (cv.certifications.length) {
    children.push(heading("Sertifikalar"));
    for (const item of cv.certifications) {
      children.push(bullet(item));
    }
  }

  if (cv.languages.length) {
    children.push(heading("Diller"));
    children.push(body(cv.languages.map((item) => (item.level ? `${item.name} (${item.level})` : item.name)).join(" · ")));
  }

  const document = new Document({
    creator: "CVMatch",
    title: `${cv.contact.fullName} — ${cv.headline}`,
    styles: { default: { document: { run: { font: "Calibri" } } } },
    sections: [{ properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, children }]
  });

  await writeFile(outputPath, await Packer.toBuffer(document));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
