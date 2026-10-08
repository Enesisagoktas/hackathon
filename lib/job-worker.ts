import type mysql from "mysql2/promise";
import { prepareApplicationsForResults, type PrepareApplicationsSummary } from "@/lib/apply/pipeline";
import { evaluateCv, type CvEvaluation } from "@/lib/cv-evaluation";
import { getCvById, getPrimaryCv, savePrimaryCv } from "@/lib/cv/store";
import { getDbPool } from "@/lib/db";
import {
  applyStageUpdate,
  createProgress,
  parseProgress,
  progressPercent,
  type SearchCounters,
  type StageKey,
  type StageStatus
} from "@/lib/jobs/progress";
import { extractProfileFromCv, type AiExtractedProfile } from "@/lib/extract-keywords";
import { ensureJobQueueSchema, parseJsonField, type JobSearchQueueRow, type QueuedFileType } from "@/lib/job-queue";
import { computeSearchFingerprint, searchCacheTtlHours } from "@/lib/jobs/search-fingerprint";
import { searchJobListings } from "@/lib/job-search";
import { normalizeCities, normalizeLocationMode, normalizeWorkMode } from "@/lib/search-preferences";
import type { JobSearchResult } from "@/lib/jobs/types";

const IDLE_DELAY_MS = 5000;
const HEARTBEAT_MS = readPositiveNumber(process.env.JOB_HEARTBEAT_MS, 5000);
// Varsayılan, canlı taramayı da kapsayacak kadar geniş: crawler tek başına
// CRAWLER_DEADLINE_MS (120sn) alabiliyor, öncesinde/sonrasında AI skorlama var.
// Eski 90sn varsayılanı, .env'de değer tanımlı değilse canlı taramayı daha
// bitmeden kesiyordu.
const SEARCH_TIMEOUT_MS = readPositiveNumber(process.env.JOB_SEARCH_TIMEOUT_MS, 360000);
const STALE_PROCESSING_MINUTES = readPositiveNumber(process.env.JOB_STALE_PROCESSING_MINUTES, 2);
/** Bir iş bu kadar denemeden sonra kalıcı olarak 'failed' yapılır. */
const MAX_JOB_ATTEMPTS = readPositiveNumber(process.env.JOB_MAX_ATTEMPTS, 4);
/** Başvuru üretmeden önce en fazla kaç ilan canlı doğrulanır. */
const VERIFY_BEFORE_APPLY_LIMIT = readPositiveNumber(process.env.VERIFY_BEFORE_APPLY_LIMIT, 15);

let backgroundWorkerRunning = false;

export function ensureJobWorkerRunning() {
  if (backgroundWorkerRunning) {
    return;
  }

  backgroundWorkerRunning = true;
  void runJobWorkerLoop("api-background").finally(() => {
    backgroundWorkerRunning = false;
  });
}

export async function runJobWorkerLoop(label = "worker") {
  console.log(`[Worker] Started background job processor (${label})...`);
  await ensureJobQueueSchema();

  while (true) {
    const processed = await processNextJob();

    if (!processed) {
      await sleep(IDLE_DELAY_MS);
    }
  }
}

export async function processNextJob() {
  await ensureJobQueueSchema();

  const job = await claimNextJob();

  if (!job) {
    return false;
  }

  // Kalp atışı işin tamamını kapsar: analiz aşaması da dahil hiçbir pencere
  // korumasız kalmaz, iş başkası tarafından "takılmış" sayılıp kapılamaz.
  const stopHeartbeat = startJobHeartbeat(job.id);

  try {
    await processClaimedJob(job);
  } catch (error) {
    console.error(`[Worker] Job ${job.id} failed:`, error);
    await markJobFailed(job.id, error);
  } finally {
    stopHeartbeat();
  }

  return true;
}

async function claimNextJob(): Promise<JobSearchQueueRow | null> {
  const pool = getDbPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // `attempts < MAX_ATTEMPTS`: worker sürecini çökerten bir iş (ör. bozuk CV
    // metni) aksi halde sonsuz yeniden-kapma döngüsüne girer ve kuyruğu
    // kilitler. Sınırı aşan işler aşağıda 'failed' yapılır.
    const [rows] = await connection.query<JobSearchQueueRow[]>(
      `SELECT *
       FROM job_searches
       WHERE attempts < ${MAX_JOB_ATTEMPTS}
         AND (
           status = 'pending'
           OR (status = 'processing' AND (locked_at IS NULL OR locked_at < DATE_SUB(NOW(), INTERVAL ${STALE_PROCESSING_MINUTES} MINUTE)))
         )
       ORDER BY
         CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
         created_at ASC
       LIMIT 1
       FOR UPDATE`
    );

    const job = rows[0];

    if (!job) {
      // Denemesi tükenmiş ama hâlâ 'pending'/'processing' görünen işleri
      // kapat; aksi halde arayüzde sonsuza dek "işleniyor" kalırlar.
      await connection.query(
        `UPDATE job_searches
         SET status = 'failed',
             progress = 100,
             completed_at = NOW(),
             locked_at = NULL,
             cv_text = NULL,
             error_message = COALESCE(error_message, 'İşlem birkaç denemede tamamlanamadı.'),
             updated_at = NOW()
         WHERE attempts >= ${MAX_JOB_ATTEMPTS} AND status IN ('pending', 'processing')`
      );

      await connection.commit();
      return null;
    }

    await connection.query(
      `UPDATE job_searches
       SET status = 'processing',
           progress = GREATEST(progress, 10),
           attempts = attempts + 1,
           locked_at = NOW(),
           started_at = COALESCE(started_at, NOW()),
           error_message = NULL,
           updated_at = NOW()
       WHERE id = ?`,
      [job.id]
    );

    const [updatedRows] = await connection.query<JobSearchQueueRow[]>("SELECT * FROM job_searches WHERE id = ?", [job.id]);

    await connection.commit();
    return updatedRows[0] ?? null;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

async function processClaimedJob(job: JobSearchQueueRow) {
  let text = job.cv_text?.trim();

  // Tamamlanmış bir iş yeniden aranmak üzere kuyruğa dönebilir (kullanıcı
  // pozisyon seçimini değiştirdi). Tamamlanınca cv_text temizlendiği için
  // metin kayıtlı ana CV'den geri yüklenir.
  if (!text && job.user_id != null) {
    const storedCv =
      (job.cv_id != null ? await getCvById(Number(job.cv_id), Number(job.user_id)) : null) ??
      (await getPrimaryCv(Number(job.user_id)));
    text = storedCv?.rawText?.trim();
  }

  if (!text) {
    throw new Error("Bu kuyruk işinde CV metni bulunamadı.");
  }

  const fileType = normalizeFileType(job.file_type);
  const locationMode = normalizeLocationMode(job.location_mode);
  const cities = normalizeCities(parseJsonField<unknown[]>(job.cities, []));
  const workMode = normalizeWorkMode(job.work_mode);
  const userEmail = typeof job.user_email === "string" ? job.user_email : undefined;
  const pool = getDbPool();

  console.log(`[Worker] Processing Job ID: ${job.id}`);
  const cachedProfile = parseJsonField<AiExtractedProfile | null>(job.ai_profile, null);
  const profileResult = isProfileResult(cachedProfile) ? cachedProfile : await extractProfileFromCv(text);

  await pool.query(
    `UPDATE job_searches
     SET progress = GREATEST(progress, 25),
         ai_profile = ?,
         target_role = ?,
         skills = ?,
         titles = ?,
         location_mode = ?,
         cities = ?,
         work_mode = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [
      JSON.stringify(profileResult),
      profileResult.titles[0] ?? null,
      JSON.stringify(profileResult.skills),
      JSON.stringify(profileResult.titles),
      locationMode,
      JSON.stringify(cities),
      workMode,
      job.id
    ]
  );

  const cachedEvaluation = parseJsonField<CvEvaluation | null>(job.evaluation, null);
  const evaluation = isCvEvaluation(cachedEvaluation)
    ? cachedEvaluation
    : await evaluateCv({ text, keywordAnalysis: profileResult, fileType });

  await pool.query(
    `UPDATE job_searches SET progress = GREATEST(progress, 40), evaluation = ?, updated_at = NOW() WHERE id = ?`,
    [JSON.stringify(evaluation), job.id]
  );

  // ── Aşama sınırı: pozisyon seçimi ──────────────────────────────────────
  // Kullanıcı analiz sonrası AI'nın önerdiği pozisyonlardan seçim yapar
  // (+ seviye filtresi + arama notu). Seçim yoksa iş burada durur; seçim
  // API'si kaydı tekrar 'pending' yapınca analiz cache'ten okunup arama
  // aşamasına geçilir.
  const selectedPositions = toStringList(parseJsonField<unknown>(job.selected_positions, null));

  if (!selectedPositions.length) {
    console.log(`[Worker] Job ${job.id} - Analiz tamam; pozisyon seçimi bekleniyor.`);
    await pool.query(
      `UPDATE job_searches
       SET status = 'awaiting_selection',
           progress = GREATEST(progress, 45),
           locked_at = NULL,
           updated_at = NOW()
       WHERE id = ?`,
      [job.id]
    );
    return;
  }

  const seniorityFilter = typeof job.seniority_filter === "string" ? job.seniority_filter : "any";
  const searchNote = typeof job.search_note === "string" && job.search_note.trim() ? job.search_note.trim() : undefined;

  // Feature #8 — parmak izi önbelleği: aynı kullanıcı + aynı CV + aynı
  // kriterlerle kısa süre önce tamamlanmış bir arama varsa boru hattını
  // yeniden koşturmadan onun sonuçları kullanılır.
  const fingerprint = computeSearchFingerprint({
    userId: job.user_id != null ? Number(job.user_id) : null,
    cvId: job.cv_id != null ? Number(job.cv_id) : null,
    cvText: text,
    selectedPositions,
    seniorityFilter,
    locationMode,
    cities,
    workMode,
    searchNote: searchNote ?? null
  });

  if (await tryReuseFingerprintedSearch(job, fingerprint)) {
    console.log(`[Worker] Job ${job.id} - Aynı parmak izli taze arama bulundu; sonuçlar önbellekten kopyalandı.`);
    return;
  }

  console.log(
    `[Worker] Job ${job.id} - Arama başlıyor. Pozisyonlar: ${selectedPositions.join(", ")}` +
      (seniorityFilter !== "any" ? ` | seviye: ${seniorityFilter}` : "") +
      (searchNote ? " | not var" : "")
  );
  await pool.query("UPDATE job_searches SET progress = GREATEST(progress, 55), updated_at = NOW() WHERE id = ?", [job.id]);

  const searchPayload = await runWithJobHeartbeat(
    job.id,
    searchJobListings(
      {
        skills: profileResult.skills,
        titles: profileResult.titles,
        languages: profileResult.languages,
        experienceAreas: profileResult.experienceAreas,
        searchKeywords: profileResult.searchKeywords,
        industries: profileResult.industries,
        locationMode,
        cities,
        workMode,
        userEmail,
        fullText: text,
        aiProfile: profileResult.aiProfile,
        selectedPositions,
        seniorityFilter,
        searchNote
      },
      // Canlı tarama yalnızca worker akışında açılır; cache yetersizse
      // platformlardan güncel ilan çekilir (kullanıcı 5 dk'ya razı).
      {
        allowLiveCrawl: process.env.LIVE_CRAWL_ENABLED !== "false",
        // §7 — Aşamalar aramannın kendisinden bildirilir; worker'ın tahmin
        // yürütmesi hem yanlış hem de kullanıcıyı yanıltıcı olurdu.
        onStage: (key, status, detail, counters) => reportStage(job.id, key, status, detail, counters)
      }
    ),
    SEARCH_TIMEOUT_MS
  );

  const scoredResults = searchPayload.results.filter((result) => result.kind === "job");

  await reportStage(job.id, "verify", "running", "İlan sayfaları açılıp doğrulanıyor", {
    found: scoredResults.length
  });

  // Başvuru üretmeden ÖNCE ilanların hâlâ yayında olduğunu doğrula.
  // Cache'teki bir ilan kapanmış olabilir; doğrulamadan devam edersek kapalı
  // ilana özel CV + ön yazı üretilir, hatta e-posta varsa otomatik gönderilir.
  const { alive, closedCount } = await dropClosedListings(scoredResults);

  const finalResults = alive;

  await reportStage(
    job.id,
    "verify",
    "done",
    `${alive.length} ilan doğrulandı${closedCount ? `, ${closedCount} ilan yayından kalkmış` : ""}`,
    { verified: alive.length },
    closedCount
  );
  const eligibleCount = finalResults.filter((result) => result.eligibility?.eligible !== false).length;
  await reportStage(
    job.id,
    "rank",
    "done",
    `${eligibleCount} uygun ilan hazır${finalResults.length > eligibleCount ? ` (+${finalResults.length - eligibleCount} gerekçeli elenen)` : ""}`,
    { eligible: eligibleCount }
  );

  const summary = {
    ...searchPayload.summary,
    resultCount: finalResults.length,
    realJobCount: finalResults.length,
    fallbackCount: 0,
    sourceNote:
      closedCount > 0
        ? `${searchPayload.summary.sourceNote} ${closedCount} ilan yayından kalkmış olduğu için listeden çıkarıldı.`
        : searchPayload.summary.sourceNote
  };

  // Eşleşen ilanlar için CV uyarlama + başvuru paketi üretimi.
  // Feature #3 güvenlik kapısı: elenen (eligible=false) ilanlar artık sonuç
  // listesinde taşınıyor ama BAŞVURU PAKETİ ÜRETİLMEZ — kullanıcının
  // başvuramayacağı ilana CV uyarlamak boşa Gemini çağrısı ve yanlış beklenti.
  const applicableResults = finalResults.filter((result) => result.eligibility?.eligible !== false);
  const applySummary = await runApplyStage(job, text, fileType, profileResult, evaluation, applicableResults);

  console.log(`[Worker] Job ${job.id} - Completed with ${finalResults.length} results.`);
  // `AND status = 'processing'` koruması: iş bu sırada başkası tarafından
  // yeniden kuyruğa alındıysa (ör. kullanıcı yeni bir seçim gönderdi ve kayıt
  // 'pending' oldu) bu tur artık geçersizdir; eski sonucu üstüne yazmaz.
  await pool.query(
    `UPDATE job_searches
     SET status = 'completed',
         progress = 100,
         completed_at = NOW(),
         result_count = ?,
         summary = ?,
         results = ?,
         apply_summary = ?,
         fingerprint = ?,
         cv_text = NULL,
         locked_at = NULL,
         error_message = NULL,
         updated_at = NOW()
     WHERE id = ? AND status = 'processing'`,
    [
      finalResults.length,
      JSON.stringify(summary),
      JSON.stringify(finalResults),
      applySummary ? JSON.stringify(applySummary) : null,
      fingerprint,
      job.id
    ]
  );
}

/**
 * Arama sonuçlarından başvuru paketleri üretir.
 *
 * Bu aşama "best effort"tur: hata verirse arama sonucu yine de kaydedilir ve
 * kullanıcı ilanlarını görür. Oturumsuz (userId olmayan) bir kuyruk işi için
 * hiç çalışmaz — başvuru sahibi belli değilse kimse adına CV üretilmez.
 */
/**
 * §22 — Arama aşamasını ve canlı sayaçları kayda yazar.
 *
 * Yüzde, aşama durumlarından türetilir; ayrı bir sayaç tutulmaz. Hata durumunda
 * sessizce geçilir: ilerleme göstergesi bir kolaylıktır, aramayı düşürmemeli.
 */
async function reportStage(
  jobId: number,
  key: StageKey,
  status: StageStatus,
  detail?: string,
  counters?: Partial<SearchCounters>,
  /**
   * "Elenen" sayacına EKLENİR (üzerine yazılmaz).
   *
   * Eleme birden çok aşamada olur: alaka/uygunluk analizinde ve yayından
   * kalkmış ilanların doğrulanmasında. Doğrulama aşaması kendi sayısını
   * yazdığında önceki eleme kaybı oluyordu (51 → 0).
   */
  addEliminated?: number
): Promise<void> {
  try {
    const pool = getDbPool();
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT progress_stages FROM job_searches WHERE id = ? LIMIT 1",
      [jobId]
    );

    const now = new Date().toISOString();
    const current = parseProgress(rows[0]?.progress_stages, now) ?? createProgress(now);
    const merged: Partial<SearchCounters> = { ...counters };

    if (addEliminated) {
      merged.eliminated = current.counters.eliminated + addEliminated;
    }

    const next = applyStageUpdate(current, { key, status, detail }, now, merged);

    await pool.query(
      `UPDATE job_searches
         SET progress_stages = ?, progress = GREATEST(progress, ?), locked_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [JSON.stringify(next), progressPercent(next), jobId]
    );
  } catch (error) {
    console.warn(`[Worker] İlerleme yazılamadı (job ${jobId}):`, error instanceof Error ? error.message : error);
  }
}

async function runApplyStage(
  job: JobSearchQueueRow,
  cvText: string,
  fileType: QueuedFileType,
  profileResult: AiExtractedProfile,
  evaluation: CvEvaluation,
  results: JobSearchResult[]
): Promise<PrepareApplicationsSummary | null> {
  const userId = job.user_id != null ? Number(job.user_id) : null;

  if (!userId || !results.length) {
    return null;
  }

  try {
    const pool = getDbPool();
    await pool.query("UPDATE job_searches SET progress = GREATEST(progress, 92), updated_at = NOW() WHERE id = ?", [job.id]);

    // Analiz çıktılarını ana CV kaydına yaz; uyarlama bunları kullanır.
    const cvId =
      job.cv_id != null
        ? Number(job.cv_id)
        : await savePrimaryCv({ userId, rawText: cvText, fileType, aiProfile: profileResult, evaluation });

    const storedCv = (await getCvById(cvId, userId)) ?? (await getPrimaryCv(userId));

    if (!storedCv) {
      console.warn(`[Worker] Job ${job.id} - Ana CV kaydı bulunamadı, başvuru üretimi atlandı.`);
      return null;
    }

    console.log(`[Worker] Job ${job.id} - ${results.length} ilan için CV uyarlama ve başvuru hazırlığı başlıyor...`);

    // Uyarlama + PDF üretimi dakikalar sürebilir; kalp atışı olmadan çalışırsa
    // durum ucu 2 dk hareketsizlikte işi "takıldı" sayıp 'pending'e döndürür
    // ve ikinci bir worker aynı işi ortadan kapar. Heartbeat locked_at'i canlı
    // tutarak bu yarışı engeller.
    const applySummary = await runWithJobHeartbeat(
      job.id,
      prepareApplicationsForResults({
        userId,
        searchId: job.id,
        cv: storedCv,
        results
      }),
      readPositiveNumber(process.env.APPLY_STAGE_TIMEOUT_MS, 480000)
    );

    console.log(
      `[Worker] Job ${job.id} - Başvuru özeti: ${applySummary.prepared} hazırlandı, ` +
        `${applySummary.autoSent} otomatik gönderildi, ${applySummary.needsReview} onay bekliyor, ` +
        `${applySummary.manualRequired} elle başvuru, ${applySummary.failed} hata.`
    );

    return applySummary;
  } catch (error) {
    // Başvuru aşaması, tamamlanmış bir aramayı asla başarısız yapmaz.
    console.error(`[Worker] Job ${job.id} - Başvuru hazırlama aşaması hata verdi:`, error);
    return {
      prepared: 0,
      autoSent: 0,
      needsReview: 0,
      manualRequired: 0,
      skippedBelowThreshold: 0,
      failed: 0,
      notes: [
        `Başvuru hazırlama aşaması hata verdi: ${error instanceof Error ? error.message : String(error)}`
      ]
    };
  }
}

async function markJobFailed(jobId: number, error: unknown) {
  const pool = getDbPool();
  const message = error instanceof Error ? error.message : "Bilinmeyen worker hatası.";

  // Tamamlanma yazımıyla aynı koruma: iş yeniden kuyruğa alındıysa eski turun
  // hatası yeni turu 'failed' yapmamalı.
  await pool.query(
    `UPDATE job_searches
     SET status = 'failed',
         progress = 100,
         error_message = ?,
         completed_at = NOW(),
         locked_at = NULL,
         cv_text = NULL,
         updated_at = NOW()
     WHERE id = ? AND status = 'processing'`,
    [message.slice(0, 2000), jobId]
  );
}

/**
 * Feature #8 — Aynı parmak izli, TTL içindeki tamamlanmış aramayı arar ve
 * bulursa sonuçlarını bu işe kopyalayıp işi 'completed' yapar.
 *
 * Sınırlar:
 *   - Parmak izi userId + cvId içerir; yine de sorguya null-güvenli user_id
 *     eşitliği eklenir (savunma katmanı — kişiselleştirilmiş skorlar asla
 *     başka kullanıcıya taşınamaz).
 *   - Boş sonuçlu arama yeniden KULLANILMAZ: boş sonucu 6 saat tekrarlamak
 *     yerine taze tarama şansı vermek daha doğru.
 *   - Kopyalanan satıra fingerprint YAZILMAZ; sonraki aramalar hep gerçek
 *     taramanın satırını bulur. Böylece cache zinciri oluşmaz ve TTL,
 *     kaynakların gerçekten tarandığı ana bağlı kalır.
 */
async function tryReuseFingerprintedSearch(job: JobSearchQueueRow, fingerprint: string): Promise<boolean> {
  const ttlHours = searchCacheTtlHours();

  if (ttlHours <= 0) {
    return false;
  }

  const pool = getDbPool();

  try {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, results, summary, apply_summary, completed_at
       FROM job_searches
       WHERE fingerprint = ?
         AND id != ?
         AND status = 'completed'
         AND user_id <=> ?
         AND results IS NOT NULL
         AND completed_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)
       ORDER BY completed_at DESC
       LIMIT 1`,
      [fingerprint, job.id, job.user_id ?? null, Math.round(ttlHours * 60)]
    );

    const prior = rows[0];

    if (!prior) {
      return false;
    }

    const results = parseJsonField<JobSearchResult[]>(prior.results, []);

    if (!results.length) {
      return false;
    }

    const priorSummary = parseJsonField<Record<string, unknown>>(prior.summary, {});
    const scannedAt = prior.completed_at instanceof Date ? prior.completed_at : new Date(String(prior.completed_at));
    const timeLabel = Number.isNaN(scannedAt.getTime())
      ? null
      : scannedAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

    const summary = {
      ...priorSummary,
      sourceNote: [
        typeof priorSummary.sourceNote === "string" ? priorSummary.sourceNote : "",
        timeLabel
          ? `Sonuçlar ${timeLabel}'de tarandı; aynı kriterli arama tekrarlandığı için önbellekten getirildi.`
          : "Aynı kriterli yakın tarihli aramanın sonuçları önbellekten getirildi."
      ]
        .filter(Boolean)
        .join(" ")
    };

    // Arayüz aşama panelini boş bırakmamak için tüm aşamalar kapatılır.
    const now = new Date().toISOString();
    const base = createProgress(now);
    const eligibleCount = results.filter((result) => result.eligibility?.eligible !== false).length;
    const progress = {
      stages: base.stages.map((stage) => ({
        ...stage,
        status: "done" as StageStatus,
        detail: stage.key === "plan" ? "Aynı kriterli yakın aramanın sonuçları önbellekten yüklendi" : stage.detail
      })),
      counters: { found: results.length, verified: results.length, eliminated: 0, eligible: eligibleCount },
      updatedAt: now
    };

    const [updateResult] = await pool.query<mysql.ResultSetHeader>(
      `UPDATE job_searches
       SET status = 'completed',
           progress = 100,
           progress_stages = ?,
           completed_at = NOW(),
           result_count = ?,
           summary = ?,
           results = ?,
           apply_summary = ?,
           cv_text = NULL,
           locked_at = NULL,
           error_message = NULL,
           updated_at = NOW()
       WHERE id = ? AND status = 'processing'`,
      [
        JSON.stringify(progress),
        results.length,
        JSON.stringify(summary),
        JSON.stringify(results),
        prior.apply_summary != null ? JSON.stringify(parseJsonField<unknown>(prior.apply_summary, null)) : null,
        job.id
      ]
    );

    return updateResult.affectedRows > 0;
  } catch (error) {
    // Önbellek bir kolaylıktır: hata verirse normal arama yoluna düşülür.
    console.warn(`[Worker] Job ${job.id} - Parmak izi önbelleği okunamadı:`, error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Başvuru paketi üretmeden önce ilanların hâlâ açık olduğunu doğrular.
 *
 * `verifyListing` bugüne kadar YALNIZCA elle çalıştırılan `npm run verify:jobs`
 * içinden çağrılıyordu; kullanıcı akışında hiç devreye girmiyordu. Sonuç:
 * kapanan bir ilan 30 gün boyunca "aktif" kalıp önerilebiliyor, ona özel CV
 * üretilebiliyor ve e-posta kanalı varsa otomatik başvuru gidebiliyordu.
 *
 * Doğrulanamayan (ağ hatası veren) ilanlar listede BIRAKILIR: geçici bir hata
 * yüzünden gerçek fırsatı silmek, kapalı ilan göstermekten daha kötü.
 */
async function dropClosedListings(
  results: JobSearchResult[]
): Promise<{ alive: JobSearchResult[]; closedCount: number }> {
  const checkable = results.filter((result) => result.listingId != null).slice(0, VERIFY_BEFORE_APPLY_LIMIT);

  if (!checkable.length) {
    return { alive: results, closedCount: 0 };
  }

  const { verifyListing } = await import("@/lib/jobs/verifier");
  const { getListingsForVerification } = await import("@/lib/jobs/repository");

  // Doğrulayıcı tam kayıt ister; id -> kayıt eşlemesi için havuzu okuruz.
  const pool = await getListingsForVerification(500).catch(() => []);
  const byId = new Map(pool.map((record) => [record.id, record]));

  const closedIds = new Set<number>();

  await Promise.all(
    checkable.map(async (result) => {
      const record = byId.get(Number(result.listingId));
      if (!record) {
        return;
      }

      try {
        const outcome = await verifyListing(record);
        if (outcome.decision === "expired") {
          closedIds.add(record.id);
          console.log(`[Worker] İlan kapanmış, listeden çıkarıldı: ${record.title} (${outcome.reason})`);
        }
      } catch {
        // Doğrulanamadı: şüpheden yararlansın, listede kalsın.
      }
    })
  );

  if (!closedIds.size) {
    return { alive: results, closedCount: 0 };
  }

  return {
    alive: results.filter((result) => result.listingId == null || !closedIds.has(Number(result.listingId))),
    closedCount: closedIds.size
  };
}

/** JSON alanından güvenli string listesi çıkarır. */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 5);
}

function normalizeFileType(value: QueuedFileType | null): QueuedFileType {
  return value === "docx" ? "docx" : "pdf";
}

function isProfileResult(value: AiExtractedProfile | null): value is AiExtractedProfile {
  return Boolean(
    value &&
    Array.isArray(value.skills) &&
    Array.isArray(value.titles) &&
    Array.isArray(value.searchKeywords) &&
    value.aiProfile &&
    typeof value.aiProfile === "object"
  );
}

function isCvEvaluation(value: CvEvaluation | null): value is CvEvaluation {
  return Boolean(value && typeof value.score === "number" && typeof value.summary === "string");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * İşin TAMAMI boyunca `locked_at`'i canlı tutar.
 *
 * Neden gerekli: `claimNextJob`, `locked_at` STALE_PROCESSING_MINUTES'tan
 * eskiyen 'processing' işleri "takılmış" sayıp yeniden kapar; durum ucu da
 * aynı ölçüte bakıp işi 'pending'e döndürür. Analiz aşaması iki Gemini
 * çağrısı (profil çıkarımı + değerlendirme) yaptığı için tek başına 2 dakikayı
 * aşabiliyor. Eskiden kalp atışı yalnızca arama ve başvuru aşamalarını
 * sarıyordu; aradaki analiz penceresi korumasızdı ve iş kendi kendine yeniden
 * kuyruğa düşüp baştan işlenebiliyordu.
 *
 * Dönen fonksiyon çağrıldığında atış durur.
 */
function startJobHeartbeat(jobId: number): () => void {
  const pool = getDbPool();
  let stopped = false;

  const timer = setInterval(() => {
    if (stopped) {
      return;
    }

    void pool
      .query(
        `UPDATE job_searches
         SET locked_at = NOW(), updated_at = NOW()
         WHERE id = ? AND status = 'processing'`,
        [jobId]
      )
      .catch((error) => console.error(`[Worker] Job ${jobId} heartbeat failed:`, error));
  }, HEARTBEAT_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** Uzun süren bir aşamayı ilerleme çubuğu + zaman aşımıyla sarar. */
async function runWithJobHeartbeat<T>(jobId: number, work: Promise<T>, timeoutMs: number) {
  const pool = getDbPool();
  let progress = 55;
  let finished = false;

  const heartbeat = setInterval(() => {
    if (finished) {
      return;
    }

    progress = Math.min(90, progress + 5);
    void pool.query(
      `UPDATE job_searches
       SET progress = GREATEST(progress, ?), locked_at = NOW(), updated_at = NOW()
       WHERE id = ? AND status = 'processing'`,
      [progress, jobId]
    ).catch((error) => console.error(`[Worker] Job ${jobId} heartbeat failed:`, error));
  }, HEARTBEAT_MS);

  try {
    return await withTimeout(work, timeoutMs, "İlan tarama ve AI eşleştirme zaman aşımına uğradı.");
  } finally {
    finished = true;
    clearInterval(heartbeat);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function readPositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
