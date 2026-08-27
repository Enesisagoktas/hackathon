import path from "path";
import { readFile } from "fs/promises";

import { extractPdfText } from "../lib/extract-pdf";

/**
 * Üretilen bir CV PDF'inin metnini basar.
 *   npx tsx scripts/inspect-cv-pdf.ts storage/applications/7/xxx.pdf
 *
 * Türkçe karakterlerin PDF'e doğru gömüldüğünü doğrulamak için kullanılır:
 * metin geri okunabiliyorsa ATS sistemleri de okuyabilir.
 */
async function run() {
  const target = process.argv[2];

  if (!target) {
    console.error("Kullanım: npx tsx scripts/inspect-cv-pdf.ts <pdf-yolu>");
    process.exitCode = 1;
    return;
  }

  const buffer = await readFile(path.resolve(target));
  const text = await extractPdfText(buffer);

  console.log(`─── ${path.basename(target)} (${buffer.byteLength} bayt) ───\n`);
  console.log(text);

  const turkishChars = text.match(/[çğıöşüÇĞİÖŞÜ]/g) ?? [];
  console.log(`\n─── Türkçe karakter sayısı: ${turkishChars.length} ───`);
  console.log(`Benzersiz: ${Array.from(new Set(turkishChars)).join(" ")}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
