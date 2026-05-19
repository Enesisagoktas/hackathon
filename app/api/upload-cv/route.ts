import { NextResponse } from "next/server";

import { extractDocxText } from "@/lib/extract-docx";
import { extractPdfText } from "@/lib/extract-pdf";
import { getDbPool } from "@/lib/db";
import mysql from "mysql2/promise";

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

    // Save the request into MySQL as a pending search job
    const pool = getDbPool();
    const [result] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO job_searches 
       (status, progress, cv_text, started_at) 
       VALUES ('pending', 0, ?, NOW())`,
      [text]
    );

    const readyAt = new Date();
    readyAt.setMinutes(readyAt.getMinutes() + 10);

    return NextResponse.json({
      searchId: result.insertId,
      status: "pending",
      readyAt: readyAt.toISOString(),
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

function errorResponse(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}
