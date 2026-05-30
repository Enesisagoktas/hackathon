import { ExternalLink, Loader2, SearchCheck } from "lucide-react";

import type { CriteriaMatchResult, JobResultCategory, JobSearchResult, JobSearchSummary } from "@/lib/job-search";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type JobLinksProps = {
  results: JobSearchResult[];
  fallbackResults?: JobSearchResult[];
  summary: JobSearchSummary | null;
  isLoading?: boolean;
};

const CATEGORY_ORDER: JobResultCategory[] = ["recommended", "general", "tech", "public"];

const CATEGORY_META: Record<JobResultCategory, { title: string; description: string; badge: string }> = {
  recommended: {
    title: "En Uygun Gerçek İlanlar",
    description: "Detay sayfası parse edilen ve CV ile en güçlü örtüşen ilanlar.",
    badge: "border-teal-200 bg-teal-50 text-teal-700"
  },
  general: {
    title: "Genel İş Platformlarından İlanlar",
    description: "Kariyer.net, Secretcv, Eleman.net ve Yenibiriş gibi kaynaklardan parse edilen ilanlar.",
    badge: "border-slate-200 bg-slate-50 text-slate-700"
  },
  tech: {
    title: "Teknoloji ve Startup İlanları",
    description: "Toptalent ve Webrazzi Jobs gibi niş platformlardan gelen gerçek ilanlar.",
    badge: "border-teal-200 bg-teal-50 text-teal-700"
  },
  public: {
    title: "Kamusal Kaynaklar",
    description: "İŞKUR gibi kaynaklardan parse edilebilen ilanlar.",
    badge: "border-blue-200 bg-blue-50 text-blue-700"
  }
};

const CONFIDENCE_LABELS: Record<JobSearchResult["confidence"], string> = {
  high: "Yüksek güven",
  medium: "Orta güven",
  low: "Manuel arama"
};

export function JobLinks({ results, fallbackResults = [], summary, isLoading = false }: JobLinksProps) {
  if (!results.length) {
    return (
      <Card className="bg-white/85">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-teal-700" /> : <SearchCheck className="h-4 w-4 text-teal-700" />}
            CV&apos;ye Uygun Gerçek İlanlar
          </CardTitle>
          <CardDescription>
            {isLoading
              ? "Platformlar taranıyor, ilan detayları okunuyor ve CV uyumu hesaplanıyor."
              : summary?.sourceNote ?? "CV analizi tamamlandıktan sonra gerçek ilan detay linkleri burada görünecek."}
          </CardDescription>
        </CardHeader>
        {fallbackResults.length ? (
          <CardContent>
            <FallbackSearches results={fallbackResults} />
          </CardContent>
        ) : null}
      </Card>
    );
  }

  const groupedLinks = CATEGORY_ORDER.map((category) => ({
    category,
    links: results.filter((result) => result.category === category)
  })).filter((group) => group.links.length);

  return (
    <Card className="bg-white/90 shadow-soft">
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-xl">CV&apos;ye Uygun Gerçek İlanlar</CardTitle>
            <CardDescription className="mt-2">
              {summary
                ? `${summary.targetRole ?? "Hedef rol"} hedef rolü için ${summary.resultCount ?? results.length} gerçek ilan CV uyumuna göre sıralandı.`
                : "Detay sayfası parse edilen ilanlar seçilen lokasyon ve çalışma modeline göre skorlandı."}
            </CardDescription>
          </div>
          {summary ? (
            <div className="rounded-2xl border bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p className="font-semibold text-slate-950">{summary.workMode ?? "Çalışma modeli fark etmez"}</p>
              <p>{summary.locations?.length ? summary.locations.join(", ") : "Tüm Türkiye"}</p>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {groupedLinks.map((group) => {
          const meta = CATEGORY_META[group.category];

          return (
            <section key={group.category} className="rounded-3xl border bg-slate-50/80 p-4">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-semibold text-slate-950">{meta.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{meta.description}</p>
                </div>
                <Badge className={cn("w-fit", meta.badge)} variant="outline">
                  {group.links.length} ilan
                </Badge>
              </div>

              <div className="grid gap-3">
                {group.links.map((result) => (
                  <JobCard key={result.id} result={result} />
                ))}
              </div>
            </section>
          );
        })}

        {summary ? (
          <div className="space-y-3 rounded-2xl border border-dashed bg-slate-50 p-4 text-sm leading-6 text-slate-600">
            <p>{summary.sourceNote ?? "Gerçek ilan detay linkleri CV uyumuna göre hazırlandı."}</p>
            {summary.crawlStatuses?.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {summary.crawlStatuses.map((status) => (
                  <div key={status.platform} className="rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                    <span className="font-semibold text-slate-800">{status.platform}</span>: {status.discoveredUrls} link bulundu, {status.parsedListings} ilan parse edildi.
                    {status.message ? <span className="block text-slate-400">{status.message}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {fallbackResults.length ? <FallbackSearches results={fallbackResults} /> : null}
      </CardContent>
    </Card>
  );
}

// ─── Job Card with Criteria Match ───────────────────────────────────────────

function JobCard({ result }: { result: JobSearchResult }) {
  return (
    <div
      className="rounded-2xl border bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-slate-200 bg-white text-slate-700" variant="outline">
              {result.platform}
            </Badge>
            <MatchScoreBadge score={result.matchScore} />
            <Badge className="border-amber-200 bg-amber-50 text-amber-700" variant="outline">
              {CONFIDENCE_LABELS[result.confidence]}
            </Badge>
            {result.criteriaMatch ? (
              <Badge className="border-violet-200 bg-violet-50 text-violet-700" variant="outline">
                Kriter: %{result.criteriaMatch.overallPercent}
              </Badge>
            ) : null}
          </div>
          <div>
            <h3 className="font-semibold text-slate-950">{result.title}</h3>
            {result.company ? <p className="mt-1 text-sm font-medium text-slate-700">{result.company}</p> : null}
            <p className="mt-1 text-sm leading-6 text-slate-500">{result.description}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <MatchRing score={result.criteriaMatch?.overallPercent ?? result.matchScore} />
          <a
            className={cn(buttonVariants({ size: "sm", variant: "default" }), "shrink-0")}
            href={result.url}
            target="_blank"
            rel="noreferrer"
          >
            {result.actionLabel}
            <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </div>
      </div>

      {/* Criteria Breakdown */}
      {result.criteriaMatch && result.criteriaMatch.criteria.length > 0 ? (
        <CriteriaBreakdown criteriaMatch={result.criteriaMatch} />
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Neden önerildi?</p>
          <ul className="mt-2 grid gap-2 text-sm leading-6 text-slate-600 sm:grid-cols-2">
            {result.matchReasons.map((reason) => (
              <li key={reason} className="rounded-xl bg-slate-50 px-3 py-2">
                {reason}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
          <span className="font-semibold text-slate-700">Kaynak sorgu:</span> {result.query}
          <br />
          <span className="font-semibold text-slate-700">İlan:</span> {result.location ?? "Lokasyon yok"} · {result.workMode ?? "Model yok"}
          {result.matchedKeywords?.length ? (
            <>
              <br />
              <span className="font-semibold text-slate-700">Eşleşen:</span> {result.matchedKeywords.slice(0, 5).join(", ")}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Criteria Breakdown Component ───────────────────────────────────────────

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

function MatchRing({ score }: { score: number }) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const color = score >= 75
    ? "#10b981"
    : score >= 50
      ? "#0d9488"
      : score >= 30
        ? "#f59e0b"
        : "#ef4444";

  return (
    <div className="relative flex h-14 w-14 items-center justify-center">
      <svg className="match-ring h-14 w-14 -rotate-90" viewBox="0 0 52 52">
        <circle cx="26" cy="26" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="4" />
        <circle
          cx="26"
          cy="26"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="match-ring-progress"
        />
      </svg>
      <span className="absolute text-xs font-bold text-slate-900">%{score}</span>
    </div>
  );
}

// ─── Fallback Searches ──────────────────────────────────────────────────────

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
