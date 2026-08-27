import { AlertTriangle, Check, CircleHelp, X } from "lucide-react";

import type { EligibilityComponent, EligibilitySummary } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";

/**
 * §14 — Kullanıcıya yalnızca yüzde göstermek yetmez.
 *
 * "%91 uyum" tek başına, adayın o ilana gerçekten başvurabilir olup olmadığını
 * söylemez. Bu panel iki soruyu ayrı ayrı cevaplar:
 *   Pozisyon → şirketin aradığı aday tipine uyuyor musun? (60 puan)
 *   Teknik   → istenen becerilere sahip misin? (40 puan)
 * ve karşılanmayan zorunlu şartları açıkça yazar.
 */

const STATUS_ICON = {
  met: Check,
  partial: AlertTriangle,
  unmet: X,
  unknown: CircleHelp
} as const;

const STATUS_STYLE = {
  met: "text-emerald-600",
  partial: "text-amber-600",
  unmet: "text-rose-600",
  unknown: "text-slate-400"
} as const;

function ComponentRow({ item }: { item: EligibilityComponent }) {
  const Icon = STATUS_ICON[item.status];

  return (
    <li className="flex items-start gap-2 text-sm leading-6">
      <Icon className={cn("mt-1 h-3.5 w-3.5 shrink-0", STATUS_STYLE[item.status])} />
      <span className="min-w-0">
        <span className="font-medium text-slate-700">{item.label}</span>
        <span className="text-slate-500"> — {item.detail}</span>
      </span>
    </li>
  );
}

export function EligibilityPanel({ eligibility }: { eligibility: EligibilitySummary }) {
  return (
    <div className="space-y-3">
      {eligibility.blockers.length > 0 ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-sm font-semibold text-rose-900">Bu ilana başvuru koşulları karşılanmıyor</p>
          <ul className="mt-1.5 space-y-1">
            {eligibility.blockers.map((blocker) => (
              <li key={blocker.code} className="text-sm leading-6 text-rose-800">
                • <span className="font-medium">{blocker.label}:</span> {blocker.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border bg-white p-3">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pozisyon uygunluğu</p>
            <p className="text-sm font-semibold text-slate-700">{Math.round(eligibility.roleScore)}/60</p>
          </div>
          <ul className="mt-2 space-y-1">
            {eligibility.roleComponents.map((item) => (
              <ComponentRow key={item.key} item={item} />
            ))}
          </ul>
        </div>

        <div className="rounded-xl border bg-white p-3">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Teknik uyum</p>
            <p className="text-sm font-semibold text-slate-700">{Math.round(eligibility.technicalScore)}/40</p>
          </div>
          <ul className="mt-2 space-y-1">
            {eligibility.technicalComponents.map((item) => (
              <ComponentRow key={item.key} item={item} />
            ))}
          </ul>
        </div>
      </div>

      {eligibility.confidence === "low" ? (
        <p className="text-xs leading-5 text-slate-500">
          Bu ilanda deneyim, eğitim ve dil şartları açıkça yazılmamış; değerlendirme ilan metnine dayanıyor.
          Başvurmadan önce ilanı okumanı öneririz.
        </p>
      ) : null}
    </div>
  );
}

/** Kart üstünde tek satırlık uygunluk rozeti. */
export function EligibilityBadge({ eligibility }: { eligibility: EligibilitySummary }) {
  if (!eligibility.eligible) {
    return (
      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
        {eligibility.blockers[0]?.label ?? "Koşullar karşılanmıyor"}
      </span>
    );
  }

  const tone =
    eligibility.band === "cok-guclu" || eligibility.band === "cok-uygun"
      ? "bg-emerald-100 text-emerald-700"
      : eligibility.band === "uygun"
        ? "bg-teal-100 text-teal-700"
        : eligibility.band === "sinirda"
          ? "bg-amber-100 text-amber-700"
          : "bg-slate-100 text-slate-600";

  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tone)}>{eligibility.bandLabel}</span>;
}
