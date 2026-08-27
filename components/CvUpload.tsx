"use client";

import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Loader2, UploadCloud } from "lucide-react";

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
import { WorkModeSelector } from "@/components/WorkModeSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

  return (
    <div className="space-y-5">
      <AccountConsent onUserChange={setRegisteredUser} />

      {registeredUser ? <ApplySettings /> : null}

      <Card className="border-teal-100 bg-white/90 shadow-soft backdrop-blur">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>CV Analizi, İlana Özel CV ve Başvuru</CardTitle>
              <CardDescription className="mt-2">
                PDF veya DOCX CV yükleyin. CV metniniz, her ilana göre yeniden yazılabilmesi için hesabınıza bağlı
                olarak saklanır; dilediğiniz an silebilirsiniz.
              </CardDescription>
            </div>
            <Badge className="w-fit border-amber-200 bg-amber-50 text-amber-700" variant="outline">
              Max 5 MB
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              className="hidden"
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleFileChange}
            />

            <label
              className={cn(
                "group flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed bg-slate-50/80 px-6 py-10 text-center transition hover:border-teal-400 hover:bg-teal-50/70",
                isDragging ? "border-teal-500 bg-teal-50" : "border-slate-200"
              )}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <UploadCloud className="mb-4 h-12 w-12 text-teal-600 transition group-hover:-translate-y-1" />
              <span className="text-lg font-semibold text-slate-950">CV dosyanızı buraya bırakın</span>
              <span className="mt-2 text-sm text-slate-500">veya dosya seçmek için tıklayın</span>
              <Button className="mt-5" type="button" variant="outline" onClick={() => inputRef.current?.click()}>
                Dosya Seç
              </Button>
            </label>

            {file ? (
              <div className="flex items-center gap-3 rounded-2xl border bg-white p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-950">{file.name}</p>
                  <p className="text-sm text-slate-500">{formatFileSize(file.size)}</p>
                </div>
                <CheckCircle2 className="h-5 w-5 text-teal-600" />
              </div>
            ) : null}

            <LocationSelector
              locationMode={locationMode}
              selectedCities={selectedCities}
              onLocationModeChange={setLocationMode}
              onCitiesChange={setSelectedCities}
            />

            <WorkModeSelector value={workMode} onChange={setWorkMode} />

            <div className="flex flex-col gap-3 rounded-3xl border bg-slate-50/80 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-slate-600">
                {isSearchingJobs ? `Sonuçlar hazırlanıyor. İlerleme: %${searchProgress}` : "Analizden sonra ilanlar CV'nize göre skorlanacak, uygun her ilan için CV'niz yeniden yazılıp başvuru paketi hazırlanacak."}
              </p>
              <Button className="self-end" disabled={!file || !registeredUser || isBusy} size="lg" type="submit">
                {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                CV Analizini Başlat
              </Button>
            </div>

            {isSearchingJobs ? (
              <div className="overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full bg-teal-600 transition-all duration-500"
                  style={{ width: `${Math.max(5, Math.min(100, searchProgress))}%` }}
                />
              </div>
            ) : null}

            {analysis ? (
              <Button
                className="w-full"
                disabled={isSearchingJobs}
                type="button"
                variant="secondary"
                onClick={() => searchJobs()}
              >
                {isSearchingJobs ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Filtrelere Göre İş Aramasını Yenile
              </Button>
            ) : null}
          </form>

          {error ? (
            <div className="mt-5 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {analysis ? (
        <div className="space-y-5">
          <Card className="bg-slate-950 text-white shadow-soft">
            <CardHeader>
              <CardTitle className="text-xl">Analiz Sonucu</CardTitle>
              <CardDescription className="text-slate-300">
                CV&apos;den çıkarılan beceri ve hedef rol gerçek ilan detaylarıyla karşılaştırıldı.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-4">
                <Metric label="CV Puanı" value={analysis.evaluation.score} />
                <Metric label="Beceri" value={analysis.skills.length} />
                <Metric label="Pozisyon" value={analysis.titles.length} />
                <Metric label="Dil" value={analysis.languages.length} />
              </div>
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/10 p-4">
                <p className="text-sm text-slate-300">Hedef rol</p>
                <p className="mt-1 text-lg font-semibold">{jobSummary?.targetRole ?? analysis.titles[0] ?? "Genel aday profili"}</p>
                {analysis.aiProfile?.seniority ? (
                  <p className="mt-1 text-sm text-slate-400">Seviye: {analysis.aiProfile.seniority} · {analysis.aiProfile.yearsOfExperience ?? "?"} yıl deneyim</p>
                ) : null}
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {jobSummary?.sourceNote ?? "İş arama sonuçları analiz tamamlandıktan sonra hazırlanır."}
                </p>
              </div>
              {analysis.aiProfile?.cvSummary ? (
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">AI Profil Özeti</p>
                  <p className="mt-2 text-sm leading-6 text-slate-200">{analysis.aiProfile.cvSummary}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <CvEvaluationCard evaluation={analysis.evaluation} />

          <div className="grid gap-4 md:grid-cols-2">
            <SkillList
              title="Çıkarılan Beceriler"
              description="CV içinde yakalanan teknik ve profesyonel beceriler."
              items={analysis.skills}
              emptyText="Beceri bulunamadı. Skill listesini genişleterek iyileştirilebilir."
            />
            <SkillList
              title="Pozisyonlar"
              description="Açık pozisyon ifadeleri veya becerilerden çıkarılan roller."
              items={analysis.titles}
              emptyText="Pozisyon çıkarılamadı."
            />
            <SkillList
              title="Diller"
              description="CV metninde yakalanan dil bilgileri."
              items={analysis.languages}
              emptyText="Dil bilgisi bulunamadı."
            />
            <SkillList
              title="Deneyim Alanları"
              description="Skill kümelerine göre basit alan çıkarımı."
              items={analysis.experienceAreas}
              emptyText="Deneyim alanı çıkarılamadı."
            />
            <SkillList
              title="Sektör ve Arama Sinyalleri"
              description="Gerçek ilan açıklamalarıyla eşleştirmek için kullanılan ek sinyaller."
              items={analysis.industries.length ? analysis.industries : analysis.searchKeywords.slice(0, 10)}
              emptyText="Ek sektör sinyali çıkarılamadı."
            />
            {analysis.aiProfile?.targetPositions?.length ? (
              <SkillList
                title="Hedef Pozisyonlar (AI)"
                description="AI tarafından belirlenen uygun hedef pozisyonlar."
                items={analysis.aiProfile.targetPositions}
                emptyText=""
              />
            ) : null}
          </div>

          <details className="rounded-3xl border bg-white/85 p-6 shadow-sm">
            <summary className="cursor-pointer text-base font-semibold text-slate-950">
              CV metin önizlemesini göster
              <span className="mt-1 block text-sm font-normal text-slate-500">
                Gizlilik için sadece kısa önizleme tutulur ve varsayılan olarak kapalıdır.
              </span>
            </summary>
            <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-950 p-4 text-sm leading-6 text-slate-100">
              {analysis.textPreview}
            </pre>
          </details>
        </div>
      ) : null}

      {applySummary ? <ApplySummaryCard summary={applySummary} /> : null}

      {registeredUser ? <ApplicationsPanel refreshToken={applicationsToken} /> : null}

      <JobLinks results={jobResults} fallbackResults={fallbackResults} summary={jobSummary} isLoading={isSearchingJobs} />
    </div>
  );
}

/** Worker'ın bu turda kaç başvuru hazırlayıp kaçını gönderdiğini özetler. */
function ApplySummaryCard({ summary }: { summary: ApplySummary }) {
  const items: Array<[string, number]> = [
    ["Hazırlanan paket", summary.prepared],
    ["Otomatik gönderilen", summary.autoSent],
    ["Onay bekleyen", summary.needsReview],
    ["Elle başvuru", summary.manualRequired]
  ];

  return (
    <Card className="border-teal-100 bg-white/90 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg">Bu turda başvuru motoru ne yaptı</CardTitle>
        <CardDescription className="mt-1">
          Eşleşen her ilan için CV&apos;niz o ilana göre yeniden yazıldı.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-4">
          {items.map(([label, value]) => (
            <div key={label} className="rounded-2xl border bg-slate-50 p-3">
              <p className="text-2xl font-semibold text-slate-950">{value}</p>
              <p className="mt-0.5 text-sm text-slate-500">{label}</p>
            </div>
          ))}
        </div>

        {summary.skippedBelowThreshold > 0 ? (
          <p className="text-sm text-slate-500">
            {summary.skippedBelowThreshold} ilan hazırlama eşiğinin altında kaldığı için atlandı.
          </p>
        ) : null}

        {summary.failed > 0 ? (
          <p className="text-sm text-red-700">{summary.failed} ilanda başvuru paketi hazırlanamadı.</p>
        ) : null}

        {summary.notes.map((note, index) => (
          <p key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600">
            {note}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
      <p className="text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-slate-300">{label}</p>
    </div>
  );
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
