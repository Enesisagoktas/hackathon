export function normalizeExtractedText(text: string) {
  return text
    .replace(/\u0000/g, " ")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function createTextPreview(text: string, maxLength = 1200) {
  const normalized = normalizeExtractedText(text);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}
