import { NextResponse } from "next/server";

import { extractDocxText } from "@/lib/extract-docx";
import { extractPdfText } from "@/lib/extract-pdf";
import { enqueueJobSearch } from "@/lib/job-queue";
import { ensureJobWorkerRunning } from "@/lib/job-worker";
import { normalizeCities, normalizeLocationMode, normalizeWorkMode } from "@/lib/search-preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type FileType = "pdf" | "docx";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!isUploadFile(file)) {
      return errorResponse("Lütfen PDF veya DOCX formatında bir CV yükleyin.", 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return errorResponse("Dosya boyutu 5 MB sınırını aşamaz.", 413);
    }

    const fileType = getFileType(file);

    if (!fileType) {
      return errorResponse("Sadece PDF ve DOCX dosyaları desteklenir.", 415);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = fileType === "pdf" ? await extractPdfText(buffer) : await extractDocxText(buffer);

    if (text.length < 20) {
      return errorResponse("CV metni okunamadı veya dosyada yeterli metin bulunamadı.", 422);
    }

    const locationMode = normalizeLocationMode(readFormString(formData, "locationMode"));
    const cities = normalizeCities(parseJsonArray(readFormString(formData, "cities")));
    const workMode = normalizeWorkMode(readFormString(formData, "workMode"));
    const userEmail = sanitizeEmail(readFormString(formData, "userEmail"));

    if (locationMode === "cities" && cities.length === 0) {
      return errorResponse("İl seç modunda en az bir il seçin.", 400);
    }

    const { searchId } = await enqueueJobSearch({
      cvText: text,
      fileType,
      userEmail,
      locationMode,
      cities,
      workMode
    });

    ensureJobWorkerRunning();

    return NextResponse.json({
      searchId,
      status: "pending",
      message: "İşlem kuyruğa alındı."
    });
  } catch (error) {
    console.error("CV upload failed", error);
    return errorResponse("CV analiz edilirken beklenmeyen bir hata oluştu.", 500);
  }
}

function getFileType(file: File): FileType | null {
  const name = file.name.toLocaleLowerCase("tr-TR");

  if (file.type === PDF_MIME || name.endsWith(".pdf")) {
    return "pdf";
  }

  if (file.type === DOCX_MIME || name.endsWith(".docx")) {
    return "docx";
  }

  return null;
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value &&
    typeof value.arrayBuffer === "function"
  );
}

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function parseJsonArray(value: string | undefined) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sanitizeEmail(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const email = value.trim().toLocaleLowerCase("tr-TR").slice(0, 190);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}
