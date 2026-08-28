"use client";

import { useState } from "react";
import { ExternalLink, Loader2, SearchCheck } from "lucide-react";

import type { CriteriaMatchResult, JobSearchResult, JobSearchSummary } from "@/lib/job-search";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EligibilityBadge, EligibilityPanel } from "@/components/EligibilityPanel";
import { cn } from "@/lib/utils";

type JobLinksProps = {
  results: JobSearchResult[];
  fallbackResults?: JobSearchResult[];
  summary: JobSearchSummary | null;
  isLoading?: boolean;
  /**
   * Arama tamamlandı ve sonuç 0 ise sebebi açıklayan bir kutu gösterilir.
   * Sayfa ilk açıldığında (henüz arama yokken) hiçbir şey çizilmez.
   */
  searchCompleted?: boolean;
};

export function JobLinks({
  results,
  fallbackResults = [],
  summary,
  isLoading = false,
  searchCompleted = false
}: JobLinksProps) {
  // Uzun listeler sayfayı şişirmesin: 6'şar göster.
  const [visibleCount, setVisibleCount] = useState(6);

  if (!results.length) {
    // Söyleyecek bir şey yokken kutu çizme — ama arama BİTTİYSE ve sonuç
    // çıkmadıysa sessiz kalma: kullanıcı neden boş olduğunu bilmeli.
    if (!isLoading && !fallbackResults.length && !searchCompleted) {
      return null;
    }

    return (
      <Card className="bg-white/85">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-teal-700" /> : <SearchCheck className="h-4 w-4 text-teal-700" />}
            Eşleşen ilanlar
          </CardTitle>
          <CardDescription>
            {isLoading ? "İlanlar CV'nize göre değerlendiriliyor." : summary?.sourceNote ?? "Uygun ilan bulunamadı."}
          </CardDescription>
        </CardHeader>
        {!isLoading && searchCompleted ? (
          <CardContent className="text-sm leading-6 text-slate-600">
            <p>Deneyebileceklerin:</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5">
              <li>Farklı veya daha genel bir pozisyon seç.</li>
              <li>Seviye filtresini &quot;Fark etmez&quot; yap.</li>
              <li>Lokasyonu &quot;Tüm Türkiye&quot; olarak genişlet.</li>
            </ul>
          </CardContent>
        ) : null}
        {fallbackResults.length ? (
          <CardContent>
            <FallbackSearches results={fallbackResults} />
          </CardContent>
        ) : null}
      </Card>
    );
  }

  return (
    <Card className="bg-white/90 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg">Eşleşen ilanlar ({results.length})</CardTitle>
        <CardDescription>
          {summary?.sourceNote ?? "İlanlar CV uyumuna göre puanlanıp sıralandı."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {results.slice(0, visibleCount).map((result) => (
          <JobCard key={result.id} result={result} />
        ))}

        {results.length > visibleCount ? (
          <Button
            className="w-full"
            type="button"
            variant="ghost"
            onClick={() => setVisibleCount((count) => count + 6)}
          >
            {results.length - visibleCount} ilan daha göster
          </Button>
        ) : null}

        {fallbackResults.length ? <FallbackSearches results={fallbackResults} /> : null}
      </CardContent>
    </Card>
  );
}

/**
 * Kompakt ilan satırı: başlık, şirket·konum, puan ve tek eylem. Kriter analizi,
 * öneri gerekçeleri gibi ikincil bilgiler "Detay" altında durur — eskiden her
 * kartta hepsi açık geldiği için 5 ilan bile sayfayı ekranlarca uzatıyordu.
 */
function JobCard({ result }: { result: JobSearchResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-2xl border bg-white shadow-sm transition hover:border-teal-200">
      <div className="flex items-start justify-between gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <MatchScoreBadge score={result.matchScore} />
            {result.eligibility ? <EligibilityBadge eligibility={result.eligibility} /> : null}
            <span className="text-xs text-slate-500">{result.platform}</span>
            {result.foundInSources && result.foundInSources.length > 1 ? (
              <span
                className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                title={result.foundInSources.join(", ")}
              >
                {result.foundInSources.length} kaynakta bulundu
              </span>
            ) : null}
            {result.workMode ? <span className="text-xs text-slate-400">{result.workMode}</span> : null}
          </div>
          <p className="mt-1 truncate font-semibold text-slate-950">{result.title}</p>
          <p className="truncate text-sm text-slate-500">
            {[result.company, result.location].filter(Boolean).join(" · ") || "Şirket bilgisi ilanda"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <a
            className={cn(buttonVariants({ size: "sm", variant: "default" }))}
            href={result.url}
            rel="noreferrer"
            target="_blank"
          >
            İlanı Aç
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </a>
          <Button size="sm" type="button" variant="ghost" onClick={() => setExpanded((open) => !open)}>
            {expanded ? "Gizle" : "Detay"}
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="space-y-3 border-t bg-slate-50/60 p-3.5">
          <p className="text-sm leading-6 text-slate-600">{result.description}</p>

          {result.matchReasons.length ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Neden önerildi?</p>
              <ul className="mt-1.5 space-y-1 text-sm leading-6 text-slate-600">
                {result.matchReasons.map((reason) => (
                  <li key={reason}>• {reason}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.eligibility ? <EligibilityPanel eligibility={result.eligibility} /> : null}

          {result.criteriaMatch && result.criteriaMatch.criteria.length > 0 ? (
            <CriteriaBreakdown criteriaMatch={result.criteriaMatch} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CriteriaBreakdown({ criteriaMatch }: { criteriaMatch: CriteriaMatchResult }) {
  const metCount = criteriaMatch.criteria.filter((c) => c.status === "met").length;
  const partialCount = criteriaMatch.criteria.filter((c) => c.status === "partial").length;
  const unmetCount = criteriaMatch.criteria.filter((c) => c.status === "unmet").length;

  return (
    <div className="mt-4 rounded-2xl border bg-gradient-to-b from-slate-50 to-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-slate-900">Kriter Eşleşme Analizi</h4>
          <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-bold text-white">
            %{criteriaMatch.overallPercent}
          </span>
        </div>
        <div className="flex gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            {metCount} karşılanıyor
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
            {partialCount} kısmen
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
            {unmetCount} eksik
          </span>
        </div>
      </div>

      {/* Overall progress bar */}
      <div className="mb-4 h-2.5 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${criteriaMatch.overallPercent}%`,
            background: criteriaMatch.overallPercent >= 70
              ? "linear-gradient(90deg, #10b981, #059669)"
              : criteriaMatch.overallPercent >= 45
                ? "linear-gradient(90deg, #f59e0b, #d97706)"
                : "linear-gradient(90deg, #ef4444, #dc2626)"
          }}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {criteriaMatch.criteria.map((item) => (
          <div
            key={item.name}
            className={cn(
              "rounded-xl border px-3 py-2.5 text-sm transition-colors",
              item.status === "met" && "border-emerald-200 bg-emerald-50/80",
              item.status === "partial" && "border-amber-200 bg-amber-50/80",
              item.status === "unmet" && "border-red-200 bg-red-50/80"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-900">{item.name}</span>
              <CriteriaStatusIcon status={item.status} />
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-600">{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CriteriaStatusIcon({ status }: { status: "met" | "partial" | "unmet" }) {
  if (status === "met") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    );
  }

  if (status === "partial") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-white">
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none"><path d="M3 6H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </span>
    );
  }

  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-400 text-white">
      <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none"><path d="M3.5 3.5L8.5 8.5M8.5 3.5L3.5 8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
    </span>
  );
}

// ─── Match Score Badge ──────────────────────────────────────────────────────

function MatchScoreBadge({ score }: { score: number }) {
  const badgeClass = score >= 75
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : score >= 50
      ? "border-teal-200 bg-teal-50 text-teal-700"
      : score >= 30
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-red-200 bg-red-50 text-red-700";

  return (
    <Badge className={badgeClass} variant="outline">
      %{score} eşleşme
    </Badge>
  );
}

// ─── Match Ring (SVG donut) ─────────────────────────────────────────────────

function FallbackSearches({ results }: { results: JobSearchResult[] }) {
  return (
    <details className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-amber-900">
        Yedek arama linkleri
        <span className="mt-1 block text-xs font-normal leading-5 text-amber-800">
          Bunlar ana sonuç değildir; sadece crawler gerçek ilan çıkaramazsa manuel kontrol için tutulur.
        </span>
      </summary>
      <div className="mt-3 grid gap-2">
        {results.map((result) => (
          <a
            key={result.id}
            className="flex flex-col gap-1 rounded-xl bg-white px-3 py-2 text-sm text-slate-700 transition hover:text-teal-700 sm:flex-row sm:items-center sm:justify-between"
            href={result.url}
            target="_blank"
            rel="noreferrer"
          >
            <span>
              <span className="font-semibold">{result.platform}</span> · {result.query}
            </span>
            <span className="text-xs text-slate-400">Manuel aç</span>
          </a>
        ))}
      </div>
    </details>
  );
}
