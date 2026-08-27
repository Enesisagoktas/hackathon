import { readFile } from "fs/promises";
import path from "path";

import { NextResponse } from "next/server";

import { requireSessionUser, UnauthorizedError } from "@/lib/auth/session";
import { getApplication, getApplicationFilePaths } from "@/lib/apply/repository";
import { applicationFileName } from "@/lib/apply/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORAGE_ROOT = path.resolve(
  process.env.APPLICATION_FILES_DIR ?? path.join(process.cwd(), "storage", "applications")
);

const CONTENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
} as const;

/** Uyarlanmış CV dosyasını indirir. `?format=pdf` (varsayılan) veya `?format=docx`. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireSessionUser();
    const applicationId = Number.parseInt(params.id, 10);

    if (!Number.isFinite(applicationId)) {
      return NextResponse.json({ message: "Geçersiz başvuru numarası." }, { status: 400 });
    }

    const format = new URL(request.url).searchParams.get("format") === "docx" ? "docx" : "pdf";

    // Sahiplik kontrolü sorgunun içinde: başkasının dosyası okunamaz.
    const paths = await getApplicationFilePaths(applicationId, user.id);
    const filePath = format === "docx" ? paths?.docxPath : paths?.pdfPath;

    if (!paths || !filePath) {
      return NextResponse.json({ message: `Bu başvuru için ${format.toUpperCase()} dosyası bulunamadı.` }, { status: 404 });
    }

    // Yol geçişi (path traversal) koruması: dosya depo kökünün dışına çıkamaz.
    const resolved = path.resolve(filePath);
    if (resolved !== STORAGE_ROOT && !resolved.startsWith(STORAGE_ROOT + path.sep)) {
      console.error(`[file] Depo kökü dışında dosya yolu reddedildi: ${resolved}`);
      return NextResponse.json({ message: "Dosya yolu geçersiz." }, { status: 400 });
    }

    const application = await getApplication(applicationId, user.id);
    const content = await readFile(resolved);
    const fileName = application ? applicationFileName(application, format) : `uyarlanmis-cv.${format}`;

    return new NextResponse(new Uint8Array(content), {
      headers: {
        "Content-Type": CONTENT_TYPES[format],
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Content-Length": String(content.byteLength),
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ message: error.message }, { status: 401 });
    }

    console.error("Download application file failed", error);
    return NextResponse.json({ message: "Dosya indirilemedi." }, { status: 500 });
  }
}
