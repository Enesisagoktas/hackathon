"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { AccountConsent, type RegisteredUser } from "@/components/AccountConsent";
import { ApplicationsPanel } from "@/components/ApplicationsPanel";
import { AutoApplyToggle } from "@/components/AutoApplyToggle";
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
 * Adım 5: Başvurular.
 *
 * NEDEN YALNIZCA BAŞVURULAR: Eskiden bu sayfa hem eşleşen ilanları hem
 * başvuruları gösteriyordu; ekranda iki ayrı liste, iki ayrı "Detay"
 * düğmesi ve iki ayrı amaç yan yana geliyordu. İlanlar artık /ilanlar
 * sayfasında; burada tek iş var: hazırlanan başvuruları yönetmek.
 *
 * Başvuru listesi aramadan bağımsızdır (kullanıcının tüm başvuruları);
 * ?arama=<id> yalnızca bu turun özetini göstermek için okunur.
 */
function ApplicationsPageInner() {
  const searchParams = useSearchParams();
  const [user, setUser] = useState<RegisteredUser | null>(null);
  const [applySummary, setApplySummary] = useState<ApplySummary | null>(null);

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
        setApplySummary(data.applySummary ?? null);
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
          <StepBar current={5} steps={FLOW_STEPS} />

          <AccountConsent onUserChange={setUser} />

          {user ? (
            <>
              <div>
                <Link href={paramId ? `/ilanlar?arama=${paramId}` : "/ilanlar"}>
                  <Button size="sm" type="button" variant="ghost">
                    <ArrowLeft className="mr-1.5 h-4 w-4" />
                    Eşleşen ilanlara dön
                  </Button>
                </Link>
              </div>

              <AutoApplyToggle userFullName={user.fullName} />

              {applySummary ? <ApplySummaryLine summary={applySummary} /> : null}

              <ApplicationsPanel />
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
