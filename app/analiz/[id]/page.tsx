"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { SearchProgressPanel } from "@/components/SearchProgress";
import type { SearchProgress as SearchProgressData } from "@/lib/jobs/progress";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle, Loader2, Search, Sparkles } from "lucide-react";

import type { CvEvaluation } from "@/lib/cv-evaluation";
import { cn } from "@/lib/utils";
import { CvEvaluationCard } from "@/components/CvEvaluationCard";
import { FLOW_STEPS, StepBar } from "@/components/StepBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type SearchStatus = "pending" | "processing" | "awaiting_selection" | "completed" | "failed";

type SearchState = {
  status: SearchStatus;
  progress: number;
  errorMessage?: string | null;
  evaluation?: CvEvaluation | null;
  aiProfile?: {
    skills?: string[];
    aiProfile?: { seniority?: string; yearsOfExperience?: number; cvSummary?: string };
  } | null;
  suggestedPositions?: string[];
  selectedPositions?: string[];
  /** §22 — Aşama listesi ve canlı sayaçlar. */
  progressStages?: SearchProgressData | null;
};

const SENIORITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "any", label: "Fark etmez" },
  { value: "stajyer", label: "Stajyer" },
  { value: "junior", label: "Junior / Yeni mezun" },
  { value: "mid", label: "Uzman" },
  { value: "senior", label: "Senior" }
];

const NOTE_LIMIT = 600;

/**
 * Adım 3: Analiz sonucu ve pozisyon seçimi.
 *
 * Worker CV'yi analiz edip durunca burada AI'nın en güçlü gördüğü 5 pozisyon
 * listelenir; kullanıcı pozisyonlarını, aradığı seviyeyi ve kısa bir arama
 * notunu seçip aramayı başlatır. Arama bitince /basvurular sayfasına geçilir.
 */
export default function AnalysisPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchId = Number.parseInt(String(params?.id ?? ""), 10);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSelectedRef = useRef(false);
  const [state, setState] = useState<SearchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [customPosition, setCustomPosition] = useState("");
  const [seniority, setSeniority] = useState("any");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Seçim gönderildikten sonra arama aşamasındayız; ilerleme metni değişir.
  const [selectionSent, setSelectionSent] = useState(false);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/search-jobs/${searchId}`);
      const data = await response.json();

      if (response.status === 404) {
        stopPolling();
        setError("Arama bulunamadı. Oturumunun açık olduğundan emin ol.");
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? "Durum sorgulanamadı.");
      }

      setState(data);
      setError(null);

      if (data.status === "completed") {
        stopPolling();
        // Başvurular sayfası bu aramanın sonuçlarını gösterecek. localStorage
        // bazı tarayıcılarda (gizli mod / site verisi engelli) hata fırlatır;
        // yönlendirme buna takılıp iptal olmamalı — arama id'si zaten URL'de.
        try {
          window.localStorage.setItem("cvmatch:lastSearchId", String(searchId));
        } catch {
          // Depolama yoksa sorun değil.
        }
        router.replace(`/basvurular?arama=${searchId}`);
      } else if (data.status === "failed") {
        stopPolling();
      }
    } catch (pollError) {
      setError(pollError instanceof Error ? pollError.message : "Durum sorgulanırken hata oluştu.");
    }
  }, [router, searchId, stopPolling]);

  useEffect(() => {
    if (!Number.isFinite(searchId)) {
      setError("Geçersiz arama numarası.");
      return;
    }

    void fetchStatus();
    pollingRef.current = setInterval(() => void fetchStatus(), 3000);
    return stopPolling;
  }, [fetchStatus, searchId, stopPolling]);

  // Öneriler ilk geldiğinde ilk pozisyonu bir kez seç.
  //
  // `autoSelectedRef` şart: polling her 3 saniyede yeni bir state nesnesi
  // ürettiği için efekt tekrar tekrar çalışır. Bayrak olmadan, kullanıcı tüm
  // seçimleri kaldırdığı anda bir sonraki poll seçimi geri işaretliyordu.
  useEffect(() => {
    if (autoSelectedRef.current) {
      return;
    }

    if (state?.status === "awaiting_selection" && state.suggestedPositions?.length) {
      autoSelectedRef.current = true;
      setSelected([state.suggestedPositions[0]]);
    }
  }, [state?.status, state?.suggestedPositions]);

  function togglePosition(position: string) {
    setSelected((current) =>
      current.includes(position)
        ? current.filter((item) => item !== position)
        : current.length >= 3
          ? current
          : [...current, position]
    );
  }

  async function handleStartSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const custom = customPosition.replace(/\s+/g, " ").trim();
    const positions = [...selected, ...(custom && !selected.includes(custom) ? [custom] : [])].slice(0, 5);

    if (!positions.length) {
      setError("En az bir pozisyon seç (veya kendin yaz).");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/search-jobs/${searchId}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions, seniority, note: note.trim() || undefined })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Arama başlatılamadı.");
      }

      setSelectionSent(true);
      void fetchStatus();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Arama başlatılamadı.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Hata varsa ilerleme kartı çizilmez: geçersiz arama numarasında ekranda
  // hem hata hem sonsuz dönen "analiz ediliyor" kartı görünüyordu.
  const isAnalyzing = !error && (!state || state.status === "pending" || (state.status === "processing" && !selectionSent));
  const isSearching = selectionSent && state?.status !== "failed";
  const isSelecting = state?.status === "awaiting_selection" && !selectionSent;

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#f1f7f6_100%)]">
      <div className="container max-w-3xl py-8 md:py-12">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">CVMatch</h1>
        </header>

        <div className="space-y-4">
          <StepBar current={3} steps={FLOW_STEPS} />

          {error ? (
            <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          ) : null}

          {state?.status === "failed" ? (
            <Card className="border-red-200 bg-white/90">
              <CardHeader>
                <CardTitle className="text-lg">İşlem başarısız oldu</CardTitle>
                <CardDescription>{state.errorMessage ?? "Beklenmeyen bir hata oluştu."}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button type="button" onClick={() => router.push("/")}>
                  Başa dön
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {isAnalyzing && state?.status !== "failed" && !isSelecting ? (
            <ProgressCard
              title="CV'n analiz ediliyor"
              description="Beceriler çıkarılıyor, CV puanlanıyor ve sana uygun pozisyonlar belirleniyor."
              progress={state?.progress ?? 5}
            />
          ) : null}

          {isSearching && state?.status !== "failed" ? (
            <ProgressCard
              title="İlanlar aranıyor"
              description="Cache taranıyor; yeterli ilan yoksa platformlardan canlı tarama yapılıyor ve her uygun ilan için CV'n yeniden yazılıyor. Bu birkaç dakika sürebilir — sekmeyi kapatma."
              progress={state?.progress ?? 50}
              stages={state?.progressStages}
            />
          ) : null}

          {isSelecting ? (
            <>
              {state?.evaluation ? (
                <div className="rounded-xl border border-teal-100 bg-teal-50/60 px-4 py-3 text-sm text-teal-900">
                  <Sparkles className="mr-1.5 inline h-4 w-4" />
                  CV puanın <strong>{state.evaluation.score}/100</strong>
                  {state.aiProfile?.aiProfile?.seniority ? (
                    <>
                      {" · "}
                      {state.aiProfile.aiProfile.seniority}
                      {state.aiProfile.aiProfile.yearsOfExperience != null
                        ? ` · ${state.aiProfile.aiProfile.yearsOfExperience} yıl deneyim`
                        : ""}
                    </>
                  ) : null}
                </div>
              ) : null}

              <Card className="bg-white/90 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Hangi pozisyonlar için arayalım?</CardTitle>
                  <CardDescription>
                    AI, CV&apos;ne göre en güçlü olduğun pozisyonları çıkardı. En fazla 3 tanesini seç; istersen kendi
                    pozisyonunu da yazabilirsin.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-5" onSubmit={handleStartSearch}>
                    <div className="flex flex-wrap gap-2">
                      {(state?.suggestedPositions ?? []).map((position) => {
                        const isActive = selected.includes(position);
                        return (
                          <button
                            key={position}
                            className={cn(
                              "rounded-full border px-4 py-2 text-sm font-medium transition",
                              isActive
                                ? "border-teal-600 bg-teal-600 text-white"
                                : "border-slate-300 bg-white text-slate-700 hover:border-teal-400 hover:bg-teal-50"
                            )}
                            type="button"
                            onClick={() => togglePosition(position)}
                          >
                            {position}
                          </button>
                        );
                      })}
                    </div>

                    <input
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-teal-500"
                      maxLength={80}
                      placeholder="Başka bir pozisyon yaz (isteğe bağlı)"
                      value={customPosition}
                      onChange={(event) => setCustomPosition(event.target.value)}
                    />

                    <div>
                      <p className="mb-2 text-sm font-medium text-slate-800">Aradığın seviye</p>
                      <div className="flex flex-wrap gap-2">
                        {SENIORITY_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            className={cn(
                              "rounded-full border px-3.5 py-1.5 text-sm transition",
                              seniority === option.value
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-300 bg-white text-slate-600 hover:border-slate-500"
                            )}
                            type="button"
                            onClick={() => setSeniority(option.value)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="mb-1 text-sm font-medium text-slate-800">
                        Arama notu <span className="font-normal text-slate-500">(isteğe bağlı, 3-4 cümle)</span>
                      </p>
                      <textarea
                        className="w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm leading-6 outline-none transition focus:border-teal-500"
                        maxLength={NOTE_LIMIT}
                        placeholder="Örn: Vardiyalı çalışabilirim. Özel hastane öncelikli olsun. Ameliyathane deneyimim var."
                        rows={3}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                      />
                      <p className="mt-1 text-right text-xs text-slate-400">
                        {note.length}/{NOTE_LIMIT}
                      </p>
                    </div>

                    <Button className="w-full" disabled={isSubmitting} size="lg" type="submit">
                      {isSubmitting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="mr-2 h-4 w-4" />
                      )}
                      İlanları Ara
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {state?.evaluation ? (
                <details className="rounded-2xl border bg-white/80 px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium text-slate-800">
                    Detaylı CV değerlendirmesi
                  </summary>
                  <div className="mt-4">
                    <CvEvaluationCard evaluation={state.evaluation} />
                  </div>
                </details>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function ProgressCard({
  title,
  description,
  progress,
  stages
}: {
  title: string;
  description: string;
  progress: number;
  stages?: SearchProgressData | null;
}) {
  const safeProgress = Math.max(5, Math.min(100, progress));

  return (
    <Card className="bg-white/90 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Loader2 className="h-5 w-5 animate-spin text-teal-700" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-2 rounded-full bg-teal-600 transition-all duration-500"
            style={{ width: `${safeProgress}%` }}
          />
        </div>
        <p className="mt-2 text-right text-xs text-slate-500">%{safeProgress}</p>

        {stages ? (
          <div className="mt-4 border-t pt-4">
            <SearchProgressPanel progress={stages} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
