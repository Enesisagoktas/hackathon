import mammoth from "mammoth";

import { normalizeExtractedText } from "@/lib/text";

export async function extractDocxText(buffer: Buffer) {
  if (!buffer.byteLength) {
    throw new Error("DOCX dosyası boş görünüyor.");
  }

  const result = await mammoth.extractRawText({ buffer });
  return normalizeExtractedText(result.value ?? "");
}
