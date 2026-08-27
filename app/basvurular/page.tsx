"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import type { JobSearchResult, JobSearchSummary } from "@/lib/job-search";
import { AccountConsent, type RegisteredUser } from "@/components/AccountConsent";
import { ApplicationsPanel } from "@/components/ApplicationsPanel";
import { AutoApplyToggle } from "@/components/AutoApplyToggle";
import { JobLinks } from "@/components/JobLinks";
import { FLOW_STEPS, StepBar } from "@/components/StepBar";
import { Button } from "@/components/ui/button";

type ApplySummary = {
  prepared: number;
  autoSent: number;
  needsReview: number;
  manualRequired: number;
  failed: number;
  notes: string[];
};

/**
 * Adım 4: Başvurular ve eşleşen ilanlar.
 *
 * Arama sonuçları ?arama=<id> parametresinden okunur; parametre yoksa son
 * tamamlanan arama localStorage'dan bulunur. Başvuru listesi aramadan
 * bağımsızdır (kullanıcının tüm başvuruları).
 */
function ApplicationsPageInner() {
  const searchParams = useSearchParams();
  const [user, setUser] = useState<RegisteredUser | null>(null);
  const [results, setResults] = useState<JobSearchResult[]>([]);
  const [summary, setSummary] = useState<JobSearchSummary | null>(null);
  const [applySummary, setApplySummary] = useState<ApplySummary | null>(null);
  const [searchCompleted, setSearchCompleted] = useState(false);

  const paramId = searchParams?.get("arama");

  const loadSearch = useCallback(async () => {
    const storedId =
      typeof window !== "undefined" ? window.localStorage.getItem("cvmatch:lastSearchId") : null;
    const searchId = Number.parseInt(paramId ?? storedId ?? "", 10);

    if (!Number.isFinite(searchId)) {
      return;
    }

    try {
      const response = await fetch(`/api/search-jobs/${searchId}`);
      if (!response.ok) return;
      const data = await response.json();

      if (data.status === "completed") {
        setResults((data.results ?? []).filter((result: JobSearchResult) => result.kind === "job"));
        setSummary(data.summary ?? null);
        setApplySummary(data.applySummary ?? null);
        setSearchCompleted(true);
      }
    } catch {
      // Arama okunamazsa yalnızca başvuru listesi gösterilir.
    }
  }, [paramId]);

  useEffect(() => {
    if (user) {
      void loadSearch();
    }
  }, [user, loadSearch]);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#f1f7f6_100%)]">
      <div className="container max-w-3xl py-8 md:py-12">
        <header className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">CVMatch</h1>
          <Link href="/">
            <Button size="sm" type="button" variant="outline">
              Yeni CV yükle
            </Button>
          </Link>
        </header>

        <div className="space-y-4">
          <StepBar current={4} steps={FLOW_STEPS} />

          <AccountConsent onUserChange={setUser} />

          {user ? (
            <>
              <AutoApplyToggle userFullName={user.fullName} />

              {applySummary ? <ApplySummaryLine summary={applySummary} /> : null}

              <ApplicationsPanel />

              <JobLinks results={results} summary={summary} searchCompleted={searchCompleted} />
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default function ApplicationsPage() {
  // useSearchParams, App Router'da Suspense sınırı ister.
  return (
    <Suspense fallback={null}>
      <ApplicationsPageInner />
    </Suspense>
  );
}

/** Bu arama turunda ne olduğunu tek satırda özetler. */
function ApplySummaryLine({ summary }: { summary: ApplySummary }) {
  const parts: string[] = [];

  if (summary.prepared) parts.push(`${summary.prepared} başvuru hazırlandı`);
  if (summary.autoSent) parts.push(`${summary.autoSent} tanesi otomatik gönderildi`);
  if (summary.failed) parts.push(`${summary.failed} tanesinde hata oldu`);

  const text = parts.length ? parts.join(", ") : summary.notes[0] ?? "";

  if (!text) {
    return null;
  }

  return (
    <div className="rounded-xl border border-teal-100 bg-teal-50/60 px-3 py-2 text-sm text-teal-900">{text}</div>
  );
}
