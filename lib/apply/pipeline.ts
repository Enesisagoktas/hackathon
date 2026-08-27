import path from "path";

import { decideApplicationChannel } from "@/lib/apply/channel";
import { isDryRun, sendApplicationEmail } from "@/lib/apply/mailer";
import {
  addApplicationEvent,
  createApplication,
  getApplication,
  getApplicationFilePaths,
  markApplicationFailed,
  markApplicationSent,
  saveTailoring,
  updateApplicationStatus,
  type ApplicationStatus,
  type JobApplication
} from "@/lib/apply/repository";
import { countSentToday, getApplicationSettings, type ApplicationSettings } from "@/lib/apply/settings";
import { renderTailoredCvFiles } from "@/lib/cv/render-files";
import { buildFileBaseName } from "@/lib/cv/render-files";
import { extractStructuredCv } from "@/lib/cv/structured";
import { updateStructuredCv } from "@/lib/cv/store";
import { tailorCvForListing } from "@/lib/cv/tailor";
import type { StructuredCv, TailoringListing } from "@/lib/cv/types";
import type { StoredCv } from "@/lib/cv/store";
import type { JobSearchResult } from "@/lib/jobs/types";

/**
 * Eşleşen ilanlardan başvuru paketleri üretir ve izinliyse gönderir.
 *
 * Akış (ilan başına):
 *   1. Başvuru kaydı aç (aynı ilana ikinci kez açılmaz)
 *   2. CV'yi ilana göre yeniden kurgula (uydurma yasağı `tailor.ts` içinde)
 *   3. PDF + DOCX üret
 *   4. Kanalı belirle (ilanda e-posta var mı?)
 *   5. Otomatik gönderim koşulları sağlanıyorsa gönder, yoksa onaya bırak
 *
 * Bir ilanın hata vermesi diğerlerini durdurmaz.
 */

export type PrepareApplicationsInput = {
  userId: number;
  searchId?: number;
  cv: StoredCv;
  results: JobSearchResult[];
};

export type PrepareApplicationsSummary = {
  prepared: number;
  autoSent: number;
  needsReview: number;
  manualRequired: number;
  skippedBelowThreshold: number;
  failed: number;
  notes: string[];
};

export async function prepareApplicationsForResults(
  input: PrepareApplicationsInput
): Promise<PrepareApplicationsSummary> {
  const settings = await getApplicationSettings(input.userId);
  const summary: PrepareApplicationsSummary = {
    prepared: 0,
    autoSent: 0,
    needsReview: 0,
    manualRequired: 0,
    skippedBelowThreshold: 0,
    failed: 0,
    notes: []
  };

  const eligible = input.results.filter((result) => result.matchScore >= settings.minPrepareScore);
  summary.skippedBelowThreshold = input.results.length - eligible.length;

  if (!eligible.length) {
    summary.notes.push(
      `Hiçbir ilan hazırlama eşiğini (${settings.minPrepareScore} puan) geçmedi; başvuru paketi üretilmedi.`
    );
    return summary;
  }

  // Uyarlama için yapılandırılmış CV şart; yoksa bir kez üretip kalıcı saklarız.
  const structuredCv = await ensureStructuredCv(input.cv);

  const maxPrepare = Number(process.env.APPLY_MAX_PREPARE_PER_RUN ?? 10);
  const batch = eligible.slice(0, maxPrepare);

  if (eligible.length > batch.length) {
    summary.notes.push(
      `${eligible.length} uygun ilandan ilk ${batch.length} tanesi için paket hazırlandı (APPLY_MAX_PREPARE_PER_RUN sınırı).`
    );
  }

  let sentToday = await countSentToday(input.userId);

  for (const result of batch) {
    try {
      const outcome = await prepareSingleApplication({
        userId: input.userId,
        searchId: input.searchId,
        cv: input.cv,
        structuredCv,
        result,
        settings,
        sentToday
      });

      if (outcome.alreadyExisted) {
        continue;
      }

      summary.prepared += 1;

      if (outcome.status === "sent") {
        summary.autoSent += 1;
        sentToday += 1;
      } else if (outcome.status === "needs_review") {
        summary.needsReview += 1;
      } else if (outcome.status === "manual_required") {
        summary.manualRequired += 1;
      } else if (outcome.status === "failed") {
        summary.failed += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.error(`[apply] "${result.title}" için başvuru hazırlanamadı:`, errorText(error));
    }
  }

  if (!settings.autoApplyEnabled && summary.prepared > 0) {
    summary.notes.push(
      "Otomatik başvuru kapalı olduğu için hiçbir e-posta gönderilmedi; paketler onayınızı bekliyor."
    );
  }

  return summary;
}

async function ensureStructuredCv(cv: StoredCv): Promise<StructuredCv> {
  if (cv.structuredCv?.contact) {
    return cv.structuredCv;
  }

  const structured = await extractStructuredCv(cv.rawText);
  await updateStructuredCv(cv.id, structured).catch((error) =>
    console.error("[apply] Yapılandırılmış CV kaydedilemedi:", errorText(error))
  );

  return structured;
}

type PrepareSingleInput = {
  userId: number;
  searchId?: number;
  cv: StoredCv;
  structuredCv: StructuredCv;
  result: JobSearchResult;
  settings: ApplicationSettings;
  sentToday: number;
};

async function prepareSingleApplication(
  input: PrepareSingleInput
): Promise<{ status: ApplicationStatus; alreadyExisted: boolean }> {
  const { result, settings } = input;

  const { id: applicationId, created } = await createApplication({
    userId: input.userId,
    listingId: result.listingId,
    searchId: input.searchId,
    cvId: input.cv.id,
    listingTitle: result.title,
    listingCompany: result.company,
    listingLocation: result.location,
    listingPlatform: result.platform,
    listingUrl: result.url,
    matchScore: result.matchScore
  });

  if (!created) {
    return { status: "skipped", alreadyExisted: true };
  }

  await addApplicationEvent(applicationId, "created", `Eşleşme skoru ${result.matchScore}. CV uyarlaması başlatıldı.`);

  try {
    const listing = toTailoringListing(result);

    const tailoring = await tailorCvForListing({
      masterCv: input.structuredCv,
      masterText: input.cv.rawText,
      listing,
      matchScore: result.matchScore,
      applicantEmail: input.structuredCv.contact.email
    });

    const files = await renderTailoredCvFiles(tailoring.tailoredCv, applicationId);
    const decision = decideApplicationChannel(listing);

    // GÜVENLİK KURALI: AI skoru alınamamış (confidence "low") eşleşmeler asla
    // otomatik gönderilmez. Bu sonuçlar yalnızca anahtar kelime örtüşmesine
    // dayanır; böyle bir eşleşmeye dayanarak işverene e-posta atmak kullanıcının
    // itibarına zarar verir. Bu ilanlar için paket hazırlanır ve onaya bırakılır.
    const isConfidentMatch = result.confidence !== "low";

    const canAutoSend =
      settings.autoApplyEnabled &&
      decision.channel === "email" &&
      Boolean(decision.recipientEmail) &&
      isConfidentMatch &&
      result.matchScore >= settings.autoApplyMinScore &&
      input.sentToday < settings.dailySendLimit &&
      Boolean(files.pdfPath);

    const status: ApplicationStatus =
      decision.channel === "portal" ? "manual_required" : canAutoSend ? "queued" : "needs_review";

    await saveTailoring({
      applicationId,
      tailoredCv: tailoring.tailoredCv,
      coverLetter: tailoring.coverLetter,
      emailSubject: tailoring.emailSubject,
      gaps: tailoring.gaps,
      keywordAlignment: tailoring.keywordAlignment,
      tailoringSource: tailoring.source,
      pdfPath: files.pdfPath,
      docxPath: files.docxPath,
      channel: decision.channel,
      recipientEmail: decision.recipientEmail,
      recipientSource: decision.recipientSource,
      status
    });

    await addApplicationEvent(
      applicationId,
      "tailored",
      `${tailoring.source === "ai" ? "AI" : "Kural tabanlı"} uyarlama tamam. ${decision.reason}`,
      {
        highlightedSkills: tailoring.tailoredCv.highlightedSkills,
        gapCount: tailoring.gaps.length,
        changeNotes: tailoring.changeNotes
      }
    );

    if (!canAutoSend) {
      await logAutoSendSkipReason(applicationId, decision.channel, settings, result.matchScore, input.sentToday, isConfidentMatch);
      return { status, alreadyExisted: false };
    }

    await sendPreparedApplication(applicationId, input.userId, { autoApplied: true });
    return { status: "sent", alreadyExisted: false };
  } catch (error) {
    await markApplicationFailed(applicationId, errorText(error));
    return { status: "failed", alreadyExisted: false };
  }
}

/** Otomatik gönderilmeyen her başvuru için nedeni denetim kaydına yazar. */
async function logAutoSendSkipReason(
  applicationId: number,
  channel: "email" | "portal",
  settings: ApplicationSettings,
  matchScore: number,
  sentToday: number,
  isConfidentMatch: boolean
): Promise<void> {
  if (channel === "portal") {
    await addApplicationEvent(
      applicationId,
      "manual_required",
      "İlanda başvuru e-postası yok; başvuru ilan sayfasından tamamlanmalı."
    );
    return;
  }

  const reason = !settings.autoApplyEnabled
    ? "Otomatik başvuru ayarı kapalı."
    : !isConfidentMatch
      ? "Bu ilan AI ile skorlanamadı (yalnızca anahtar kelime eşleşmesi). Düşük güvenli eşleşmeler otomatik gönderilmez."
      : matchScore < settings.autoApplyMinScore
        ? `Skor ${matchScore}, otomatik gönderim eşiği ${settings.autoApplyMinScore}.`
        : sentToday >= settings.dailySendLimit
          ? `Günlük gönderim tavanına ulaşıldı (${settings.dailySendLimit}).`
          : "CV dosyası üretilemediği için gönderim yapılmadı.";

  await addApplicationEvent(applicationId, "awaiting_approval", `Onay bekliyor. ${reason}`);
}

/**
 * Hazırlanmış bir başvuruyu gönderir. Hem otomatik akış hem de kullanıcının
 * "Gönder" tuşu buraya düşer; gönderim öncesi kontroller tek yerde toplanır.
 */
export async function sendPreparedApplication(
  applicationId: number,
  userId: number,
  options: { autoApplied: boolean }
): Promise<JobApplication> {
  const application = await getApplication(applicationId, userId);

  if (!application) {
    throw new Error("Başvuru bulunamadı.");
  }

  if (application.status === "sent") {
    throw new Error("Bu başvuru zaten gönderildi.");
  }

  if (application.channel !== "email" || !application.recipientEmail) {
    throw new Error(
      "Bu ilanda başvuru e-postası yok. Başvuruyu ilan sayfasından tamamlamanız gerekiyor."
    );
  }

  if (!application.coverLetter || !application.tailoredCv) {
    throw new Error("Başvuru paketi henüz hazır değil.");
  }

  const settings = await getApplicationSettings(userId);

  // Prova modunda ağa çıkılmadığı için SMTP sunucusu aranmaz; yine de bir
  // gönderen adresi gerekir ki üretilen mesaj gerçekçi olsun.
  if (!settings.senderEmail || (!settings.smtpHost && !isDryRun())) {
    throw new Error("Gönderim için SMTP ayarlarını tamamlamanız gerekiyor.");
  }

  const sentToday = await countSentToday(userId);
  if (sentToday >= settings.dailySendLimit) {
    throw new Error(`Günlük gönderim tavanına ulaşıldı (${settings.dailySendLimit}). Yarın tekrar deneyin.`);
  }

  const files = await getApplicationFilePaths(applicationId, userId);
  const baseName = buildFileBaseName(application.tailoredCv);

  const attachments = [
    files?.pdfPath ? { filename: `${baseName}.pdf`, path: files.pdfPath } : null,
    files?.docxPath ? { filename: `${baseName}.docx`, path: files.docxPath } : null
  ].filter((item): item is { filename: string; path: string } => item !== null);

  if (!attachments.length) {
    throw new Error("Uyarlanmış CV dosyası bulunamadı. Başvuruyu yeniden hazırlayın.");
  }

  try {
    const sendResult = await sendApplicationEmail({
      settings,
      to: application.recipientEmail,
      subject: application.emailSubject ?? `${application.listingTitle} Başvurusu`,
      coverLetter: application.coverLetter,
      attachments,
      applicantName: application.tailoredCv.contact.fullName
    });

    await markApplicationSent(applicationId, { autoApplied: options.autoApplied, messageId: sendResult.messageId });

    console.log(
      `[apply] Başvuru gönderildi → ${application.recipientEmail} (${application.listingTitle}, skor ${application.matchScore})`
    );
  } catch (error) {
    await markApplicationFailed(applicationId, `Gönderim başarısız: ${errorText(error)}`);
    throw error;
  }

  const updated = await getApplication(applicationId, userId);
  if (!updated) {
    throw new Error("Başvuru gönderildikten sonra okunamadı.");
  }

  return updated;
}

export async function skipApplication(applicationId: number, userId: number, reason?: string): Promise<void> {
  const application = await getApplication(applicationId, userId);

  if (!application) {
    throw new Error("Başvuru bulunamadı.");
  }

  if (application.status === "sent") {
    throw new Error("Gönderilmiş bir başvuru atlanamaz.");
  }

  await updateApplicationStatus(applicationId, "skipped", reason ?? "Kullanıcı bu ilanı atladı.");
}

/** Portal başvurusunun elle tamamlandığını işaretler. */
export async function markManuallyApplied(applicationId: number, userId: number): Promise<void> {
  const application = await getApplication(applicationId, userId);

  if (!application) {
    throw new Error("Başvuru bulunamadı.");
  }

  await updateApplicationStatus(applicationId, "sent", "Kullanıcı ilan sayfasından elle başvurduğunu bildirdi.");
}

function toTailoringListing(result: JobSearchResult): TailoringListing {
  return {
    title: result.title,
    company: result.company,
    location: result.location,
    platform: result.platform,
    workMode: result.workMode,
    description: result.description ?? "",
    requirements: result.requirements ?? [],
    candidateCriteria: result.candidateCriteria ?? [],
    url: result.url
  };
}

export function applicationFileName(application: JobApplication, format: "pdf" | "docx"): string {
  if (application.tailoredCv) {
    return `${buildFileBaseName(application.tailoredCv)}.${format}`;
  }
  return `uyarlanmis-cv-${application.id}.${format}`;
}

export function safeBasename(filePath: string): string {
  return path.basename(filePath);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
