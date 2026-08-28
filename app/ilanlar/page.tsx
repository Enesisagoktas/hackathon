"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";

import type { JobSearchResult, JobSearchSummary } from "@/lib/job-search";
import { AccountConsent, type RegisteredUser } from "@/components/AccountConsent";
import { JobFilters, applyJobFilters, DEFAULT_FILTERS, type JobFilterState } from "@/components/JobFilters";
import { JobLinks } from "@/components/JobLinks";
import { FLOW_STEPS, StepBar } from "@/components/StepBar";
import { Button } from "@/components/ui/button";

/**
 * Adım 4: Eşleşen ilanlar.
 *
 * NEDEN AYRI SAYFA: İlanlar ve başvurular tek sayfada durduğunda ekranda iki
 * ayrı liste, iki ayrı "Detay" düğmesi ve iki ayrı amaç yan yana geliyordu;
 * kullanıcı hangisine bakacağını bilemiyordu. Bu sayfanın tek amacı var:
 * eşleşen ilanları gözden geçirmek. Başvuru yönetimi bir sonraki adımda.
 */
function JobsPageInner() {
  const searchParams = useSearchParams();
  const [user, setUser] = useState<RegisteredUser | null>(null);
  const [results, setResults] = useState<JobSearchResult[]>([]);
  const [summary, setSummary] = useState<JobSearchSummary | null>(null);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [filters, setFilters] = useState<JobFilterState>(DEFAULT_FILTERS);

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
        setSearchCompleted(true);
      }
    } catch {
      // Arama okunamazsa sayfa boş görünür; kullanıcı yeni arama başlatabilir.
    }
  }, [paramId]);

  useEffect(() => {
    if (user) {
      void loadSearch();
    }
  }, [user, loadSearch]);

  const visible = useMemo(() => applyJobFilters(results, filters), [results, filters]);

  const applicationsHref = paramId ? `/basvurular?arama=${paramId}` : "/basvurular";

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
              {results.length > 1 ? (
                <JobFilters
                  results={results}
                  filters={filters}
                  onChange={setFilters}
                  visibleCount={visible.length}
                />
              ) : null}

              <JobLinks results={visible} summary={summary} searchCompleted={searchCompleted} />

              {results.length ? (
                <div className="flex justify-end">
                  <Link href={applicationsHref}>
                    <Button size="sm" type="button">
                      Başvurulara geç
                      <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default function JobsPage() {
  // useSearchParams, App Router'da Suspense sınırı ister.
  return (
    <Suspense fallback={null}>
      <JobsPageInner />
    </Suspense>
  );
}
