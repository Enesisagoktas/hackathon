import pdfParse from "pdf-parse/lib/pdf-parse.js";

import { normalizeExtractedText } from "@/lib/text";

type PdfParseResult = {
  text?: string;
};

export async function extractPdfText(buffer: Buffer) {
  if (!buffer.byteLength) {
    throw new Error("PDF dosyası boş görünüyor.");
  }

  const result = (await pdfParse(buffer)) as PdfParseResult;
  return normalizeExtractedText(result.text ?? "");
}
