import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth/session";
import { savePrimaryCv } from "@/lib/cv/store";
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

    if (locationMode === "cities" && cities.length === 0) {
      return errorResponse("İl seç modunda en az bir il seçin.", 400);
    }

    // Kimlik yalnızca imzalı oturum çerezinden okunur; istemciden gelen
    // e-posta alanına güvenilmez.
    const user = await getSessionUser();

    if (!user) {
      return errorResponse("CV yüklemek için giriş yapmanız gerekiyor.", 401);
    }

    // CV'yi ana CV olarak sakla: her ilana göre yeniden yazabilmek için
    // ham metnin kalıcı olması gerekiyor.
    const cvId = await savePrimaryCv({
      userId: user.id,
      rawText: text,
      fileType,
      fileName: file.name.slice(0, 255)
    });

    const { searchId } = await enqueueJobSearch({
      cvText: text,
      fileType,
      userEmail: user.email,
      userId: user.id,
      cvId,
      locationMode,
      cities,
      workMode
    });

    ensureJobWorkerRunning();

    return NextResponse.json({
      searchId,
      cvId,
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


function errorResponse(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}
