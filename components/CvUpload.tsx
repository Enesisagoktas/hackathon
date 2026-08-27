"use client";

import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, FileText, Loader2, UploadCloud } from "lucide-react";

import type { JobSearchResult, JobSearchSummary } from "@/lib/job-search";
import type { LocationMode, WorkMode } from "@/lib/search-preferences";
import type { CvEvaluation } from "@/lib/cv-evaluation";
import type { AiCvProfile } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { AccountConsent, type RegisteredUser } from "@/components/AccountConsent";
import { ApplicationsPanel } from "@/components/ApplicationsPanel";
import { ApplySettings } from "@/components/ApplySettings";
import { CvEvaluationCard } from "@/components/CvEvaluationCard";
import { JobLinks } from "@/components/JobLinks";
import { LocationSelector } from "@/components/LocationSelector";
import { SkillList } from "@/components/SkillList";
import { StepBar } from "@/components/StepBar";
import { WorkModeSelector } from "@/components/WorkModeSelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type AnalysisResult = {
  skills: string[];
  titles: string[];
  languages: string[];
  experienceAreas: string[];
  industries: string[];
  searchKeywords: string[];
  evaluation: CvEvaluation;
  textPreview: string;
  fullText: string;
  aiProfile?: AiCvProfile;
  file: {
    name: string;
    size: number;
    type: "pdf" | "docx";
  };
};

/** Worker'ın başvuru aşamasından dönen özet. */
type ApplySummary = {
  prepared: number;
  autoSent: number;
  needsReview: number;
  manualRequired: number;
  skippedBelowThreshold: number;
  failed: number;
  notes: string[];
};

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];

export function CvUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [registeredUser, setRegisteredUser] = useState<RegisteredUser | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [locationMode, setLocationMode] = useState<LocationMode>("all-turkey");
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [workMode, setWorkMode] = useState<WorkMode>("any");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [jobResults, setJobResults] = useState<JobSearchResult[]>([]);
  const [fallbackResults, setFallbackResults] = useState<JobSearchResult[]>([]);
  const [jobSummary, setJobSummary] = useState<JobSearchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSearchingJobs, setIsSearchingJobs] = useState(false);
  const [searchProgress, setSearchProgress] = useState(0);
  const [applySummary, setApplySummary] = useState<ApplySummary | null>(null);
  // Değeri değiştiğinde başvuru panosu kendini yeniler.
  const [applicationsToken, setApplicationsToken] = useState(0);
  // Ayarlar varsayılan olarak kapalı: kullanıcı CV yüklemeden SMTP formuyla
  // karşılaşmamalı.
  const [showSettings, setShowSettings] = useState(false);
  // Analiz bittikten sonra yükleme formu tek satıra kapanır; "Yeni CV yükle"
  // ile tekrar açılır.
  const [uploaderOpen, setUploaderOpen] = useState(true);

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setError("Devam etmek için PDF veya DOCX formatında bir CV seçin.");
      return;
    }

    if (!registeredUser) {
      setError("Devam etmek için KVKK onaylarını tamamlayın.");
      return;
    }

    if (locationMode === "cities" && !selectedCities.length) {
      setError("İl seç modunda iş araması yapmak için en az bir il seçin.");
      return;
    }

    stopPolling();
    setError(null);
    setIsUploading(true);
    setSearchProgress(0);
    setJobResults([]);
    setFallbackResults([]);
    setJobSummary(null);
    setAnalysis(null);
    setApplySummary(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("locationMode", locationMode);
      formData.append("cities", JSON.stringify(selectedCities));
      formData.append("workMode", workMode);

      const response = await fetch("/api/upload-cv", {
        method: "POST",
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "CV gönderilemedi.");
      }

      if (data.status === "pending" && data.searchId) {
        setIsUploading(false);
        setIsSearchingJobs(true);
        pollSearch(data.searchId);
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Beklenmeyen bir hata oluştu.");
      setIsUploading(false);
      setIsSearchingJobs(false);
    }
  }

  async function pollSearch(searchId: number) {
    stopPolling();

    const fetchStatus = async () => {
      try {
        const response = await fetch(`/api/search-jobs/${searchId}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message ?? "Durum sorgulanamadı.");
        }

        setError(null);
        setSearchProgress(typeof data.progress === "number" ? data.progress : 0);

        if (data.status === "completed") {
          stopPolling();
          
          const profileResult = data.aiProfile;
          if (profileResult && data.evaluation) {
            setAnalysis({
              skills: profileResult.skills || [],
              titles: profileResult.titles || [],
              languages: profileResult.languages || [],
              experienceAreas: profileResult.experienceAreas || [],
              industries: profileResult.industries || [],
              searchKeywords: profileResult.searchKeywords || [],
              aiProfile: profileResult.aiProfile,
              evaluation: data.evaluation,
              textPreview: "CV detayları başarıyla analiz edildi.",
              fullText: "",
              file: {
                name: file?.name || "CV",
                size: file?.size || 0,
                type: "pdf"
              }
            });
          }
          
          // Filter out generic search links, keeping only real job results
          const validJobs = (data.results || []).filter((r: any) => r.kind === "job");
          
          setJobResults(validJobs);
          setFallbackResults([]); // Don't show fallback links in UX
          setJobSummary(data.summary ?? null);
          setApplySummary(data.applySummary ?? null);
          setIsSearchingJobs(false);
          setSearchProgress(100);
          // Sonuçlar geldi: yükleme formunu kapat, ekranı başvurulara bırak.
          setUploaderOpen(false);
          // Başvuru paketleri worker tarafından üretildi; panoyu tazele.
          setApplicationsToken((token) => token + 1);
        } else if (data.status === "failed") {
          stopPolling();
          setError(data.errorMessage ?? "İşlem sırasında bir hata oluştu.");
          setIsSearchingJobs(false);
          setSearchProgress(100);
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : "Durum sorgulanırken hata oluştu.");
      }
    };

    pollingRef.current = setInterval(fetchStatus, 3000);
    fetchStatus();
  }

  function stopPolling() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  async function searchJobs(nextAnalysis = analysis) {
    if (!nextAnalysis) {
      return;
    }

    if (locationMode === "cities" && !selectedCities.length) {
      setError("İl seç modunda iş araması yapmak için en az bir il seçin.");
      return;
    }

    // Re-filtering hits the cache-first /api/search-jobs endpoint directly with
    // the already-extracted profile. No re-upload and no live crawler.
    stopPolling();
    setError(null);
    setIsSearchingJobs(true);
    setSearchProgress(55);

    try {
      const response = await fetch("/api/search-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: nextAnalysis.skills,
          titles: nextAnalysis.titles,
          languages: nextAnalysis.languages,
          experienceAreas: nextAnalysis.experienceAreas,
          searchKeywords: nextAnalysis.searchKeywords,
          industries: nextAnalysis.industries,
          aiProfile: nextAnalysis.aiProfile,
          fullText: nextAnalysis.fullText,
          locationMode,
          cities: selectedCities,
          workMode,
          userEmail: registeredUser?.email
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "İş araması yapılamadı.");
      }

      const validJobs = (data.results || []).filter((result: JobSearchResult) => result.kind === "job");
      setJobResults(validJobs);
      setFallbackResults([]);
      setJobSummary(data.summary ?? null);
      setSearchProgress(100);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "İş araması sırasında hata oluştu.");
    } finally {
      setIsSearchingJobs(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    selectFile(selectedFile);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    const droppedFile = event.dataTransfer.files?.[0] ?? null;
    selectFile(droppedFile);
  }

  function selectFile(selectedFile: File | null) {
    setError(null);
    stopPolling();
    setAnalysis(null);
    setJobResults([]);
    setFallbackResults([]);
    setJobSummary(null);
    setSearchProgress(0);

    if (!selectedFile) {
      setFile(null);
      return;
    }

    const looksLikeAcceptedFile =
      ACCEPTED_TYPES.includes(selectedFile.type) ||
      selectedFile.name.toLocaleLowerCase("tr-TR").endsWith(".pdf") ||
      selectedFile.name.toLocaleLowerCase("tr-TR").endsWith(".docx");

    if (!looksLikeAcceptedFile) {
      setFile(null);
      setError("Sadece PDF veya DOCX formatında CV yükleyebilirsiniz.");
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      setFile(null);
      setError("Dosya boyutu 5 MB sınırını aşamaz.");
      return;
    }

    setFile(selectedFile);
  }

  const isBusy = isUploading || isSearchingJobs;

  // Akış üç adım: giriş → CV yükle → başvurular. Adım, kullanıcının gerçek
  // durumundan türetilir; ayrı bir "sihirbaz" durumu tutulmaz.
  const step = !registeredUser ? 1 : analysis ? 3 : 2;
  const showUploader = Boolean(registeredUser) && (uploaderOpen || !analysis);

  return (
    <div className="space-y-4">
      <StepBar current={step} steps={["Giriş", "CV yükle", "Başvurular"]} />

      <AccountConsent
        onUserChange={setRegisteredUser}
        onOpenSettings={() => setShowSettings((open) => !open)}
      />

      {registeredUser && showSettings ? <ApplySettings defaultOpen /> : null}

      {error ? (
        <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      {/* ── Adım 2: CV yükle ── */}
      {registeredUser && !showUploader ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-white/80 px-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-teal-700" />
            <span className="truncate text-slate-700">{file?.name ?? "CV yüklendi"}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {/* Aynı CV'yi yeniden yüklemeden sadece filtreleri uygulayıp arar. */}
            <Button
              size="sm"
              disabled={isBusy}
              type="button"
              variant="ghost"
              onClick={() => void searchJobs()}
            >
              {isBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Yeniden ara
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setUploaderOpen(true)}>
              Yeni CV yükle
            </Button>
          </span>
        </div>
      ) : null}

      {showUploader ? (
        <Card className="bg-white/90 shadow-sm">
          <CardContent className="pt-6">
            <form className="space-y-4" onSubmit={handleSubmit}>
              <input
                ref={inputRef}
                className="hidden"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleFileChange}
              />

              <label
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-slate-50/80 px-6 py-8 text-center transition hover:border-teal-400 hover:bg-teal-50/60",
                  isDragging ? "border-teal-500 bg-teal-50" : "border-slate-200"
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
              >
                <UploadCloud className="mb-2 h-8 w-8 text-teal-600" />
                <span className="font-medium text-slate-900">
                  {file ? file.name : "CV dosyanı buraya bırak veya tıkla"}
                </span>
                <span className="mt-1 text-xs text-slate-500">
                  {file ? formatFileSize(file.size) : "PDF veya DOCX · en fazla 5 MB"}
                </span>
              </label>

              {/* Tercihler ikincil: varsayılanlarla da çalışır, isteyen açar. */}
              <details className="rounded-2xl border bg-white px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-800">
                  Arama tercihleri
                  <span className="ml-2 font-normal text-slate-500">
                    ({locationMode === "all-turkey" ? "Tüm Türkiye" : `${selectedCities.length} il`} ·{" "}
                    {workMode === "any" ? "fark etmez" : workMode === "remote" ? "uzaktan" : workMode === "hybrid" ? "hibrit" : "ofisten"})
                  </span>
                </summary>
                <div className="mt-4 space-y-4">
                  <LocationSelector
                    locationMode={locationMode}
                    selectedCities={selectedCities}
                    onLocationModeChange={setLocationMode}
                    onCitiesChange={setSelectedCities}
                  />
                  <WorkModeSelector value={workMode} onChange={setWorkMode} />
                </div>
              </details>

              <Button className="w-full" disabled={!file || !registeredUser || isBusy} size="lg" type="submit">
                {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isBusy ? `Hazırlanıyor… %${searchProgress}` : "Başlat"}
              </Button>

            </form>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Adım 3: sonuçlar ── */}
      {applySummary ? <ApplySummaryLine summary={applySummary} /> : null}

      {registeredUser ? <ApplicationsPanel refreshToken={applicationsToken} /> : null}

      <JobLinks results={jobResults} fallbackResults={fallbackResults} summary={jobSummary} isLoading={isSearchingJobs} />

      {/* Analizin tamamı ikincil bilgi: tek katlanabilir bölümde toplandı.
          Eskiden burada koyu bir "Analiz Sonucu" kartı, ayrı bir değerlendirme
          kartı ve altı adet beceri kartı yan yana duruyordu. */}
      {analysis ? (
        <details className="rounded-2xl border bg-white/80 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-800">
            CV analizin
            <span className="ml-2 font-normal text-slate-500">
              (puan {analysis.evaluation.score}/100 · {analysis.skills.length} beceri)
            </span>
          </summary>

          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Hedef rol</p>
              <p className="mt-0.5 font-medium text-slate-900">
                {jobSummary?.targetRole ?? analysis.titles[0] ?? "Genel aday profili"}
              </p>
              {analysis.aiProfile?.seniority ? (
                <p className="mt-1 text-sm text-slate-600">
                  {analysis.aiProfile.seniority} · {analysis.aiProfile.yearsOfExperience ?? "?"} yıl deneyim
                </p>
              ) : null}
              {analysis.aiProfile?.cvSummary ? (
                <p className="mt-2 text-sm leading-6 text-slate-600">{analysis.aiProfile.cvSummary}</p>
              ) : null}
            </div>

            <CvEvaluationCard evaluation={analysis.evaluation} />

            <div className="grid gap-3 md:grid-cols-2">
              <SkillList
                title="Beceriler"
                description="CV'de yakalanan beceriler."
                items={analysis.skills}
                emptyText="Beceri bulunamadı."
              />
              <SkillList
                title="Pozisyonlar"
                description="Sana uygun görülen roller."
                items={analysis.titles}
                emptyText="Pozisyon çıkarılamadı."
              />
              <SkillList
                title="Diller"
                description="CV'de geçen dil bilgisi."
                items={analysis.languages}
                emptyText="Dil bilgisi bulunamadı."
              />
              <SkillList
                title="Deneyim alanları"
                description="Öne çıkan çalışma alanların."
                items={analysis.experienceAreas}
                emptyText="Deneyim alanı çıkarılamadı."
              />
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Bu turda ne olduğunu tek satırda söyler.
 *
 * Eskiden burada dört metrik kutusu olan ayrı bir kart vardı; aynı sayılar
 * hemen altındaki başvuru listesinin başlığında zaten gösteriliyordu.
 */
function ApplySummaryLine({ summary }: { summary: ApplySummary }) {
  const parts: string[] = [];

  if (summary.prepared) parts.push(`${summary.prepared} başvuru hazırlandı`);
  if (summary.autoSent) parts.push(`${summary.autoSent} tanesi otomatik gönderildi`);
  if (summary.failed) parts.push(`${summary.failed} tanesinde hata oldu`);

  const text = parts.length ? parts.join(", ") : summary.notes[0] ?? "Uygun ilan bulunamadı.";

  return (
    <div className="rounded-xl border border-teal-100 bg-teal-50/60 px-3 py-2 text-sm text-teal-900">
      {text}
    </div>
  );
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
