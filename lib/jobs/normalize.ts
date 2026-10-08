import * as cheerio from "cheerio";

import { TURKEY_CITIES } from "@/lib/turkey-cities";
import type { WorkMode } from "@/lib/search-preferences";

const CITY_PATTERN = new RegExp(`\\b(${TURKEY_CITIES.map(escapeRegExp).join("|")})\\b`, "i");

export function cleanText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeComparable(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(value: string) {
  return normalizeComparable(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Konum metnindeki tekrarlı parçaları atar.
 *
 * Bazı kaynaklar (ör. Secretcv çoklu lokasyon ilanları) konumu "İstanbul
 * Anadolu, İstanbul Avrupa, İstanbul Anadolu, İstanbul Avrupa" gibi tekrarla
 * yayınlıyor; kartta amatör görünüyor. Parçalar virgülle ayrılır, ilk görülen
 * yazım korunur (sıra bozulmaz).
 */
export function dedupeLocationSegments(value: string): string {
  const seen = new Set<string>();
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const unique = parts.filter((part) => {
    const key = part.toLocaleLowerCase("tr-TR");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return unique.length ? unique.join(", ") : value.trim();
}

export function absoluteUrl(href: string, baseUrl: string) {
  try {
    return new URL(href, baseUrl).toString().split("#")[0];
  } catch {
    return null;
  }
}

export function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return url.replace(/\/+$/, "");
  }
}

export function inferWorkMode(text: string): WorkMode | undefined {
  const normalized = normalizeComparable(text);

  if (/\b(remote|uzaktan|evden|home office|homeoffice)\b/.test(normalized)) {
    return "remote";
  }

  if (/\b(hibrit|hybrid)\b/.test(normalized)) {
    return "hybrid";
  }

  if (/\b(ofisten|ofis|is yerinde|saha|onsite)\b/.test(normalized)) {
    return "onsite";
  }

  return undefined;
}

export function inferCity(text: string) {
  const match = text.match(CITY_PATTERN);
  return match?.[1];
}

export function extractExternalId(url: string) {
  const numericId = url.match(/(\d{5,})(?:[/?#]|$)/)?.[1];
  return numericId ?? undefined;
}

export function truncateText(text: string, maxLength = 420) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim()}...`;
}

export function extractJsonLdJobs(html: string) {
  const $ = cheerio.load(html);
  const jobs: Record<string, unknown>[] = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text();

    if (!raw.trim()) {
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      collectJobPostingObjects(parsed, jobs);
    } catch {
      // Some sites inject invalid JSON-LD. Generic HTML parsing still handles those pages.
    }
  });

  return jobs;
}

export function readString(value: unknown) {
  return typeof value === "string" ? cleanText(value) : undefined;
}

export function readNestedString(value: unknown, path: string[]) {
  let cursor = value;

  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || !(key in cursor)) {
      return undefined;
    }

    cursor = (cursor as Record<string, unknown>)[key];
  }

  return readString(cursor);
}

export function uniq<T>(items: T[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function collectJobPostingObjects(value: unknown, output: Record<string, unknown>[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJobPostingObjects(item, output));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const objectValue = value as Record<string, unknown>;
  const type = objectValue["@type"];
  const typeText = Array.isArray(type) ? type.join(" ") : String(type ?? "");

  if (/JobPosting/i.test(typeText)) {
    output.push(objectValue);
  }

  Object.values(objectValue).forEach((item) => collectJobPostingObjects(item, output));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
