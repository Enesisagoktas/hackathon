"use client";

import { Check, CircleDashed, Loader2, MinusCircle, X } from "lucide-react";

import type { SearchProgress as SearchProgressData, StageStatus } from "@/lib/jobs/progress";
import { cn } from "@/lib/utils";

/**
 * §22 — Arama sırasında sistemin gerçekten çalıştığını gösterir.
 *
 * Arama, kaynakları boğmamak için kontrollü ilerler ve dakikalar sürebilir.
 * Boş bir "Lütfen bekleyin" ekranı bu sürede kullanıcıya sistemin donduğunu
 * düşündürüyor. Burada hangi aşamada olunduğu ve canlı sayaçlar gösterilir.
 */

const STATUS_ICON: Record<StageStatus, typeof Check> = {
  done: Check,
  running: Loader2,
  pending: CircleDashed,
  skipped: MinusCircle,
  failed: X
};

const STATUS_STYLE: Record<StageStatus, string> = {
  done: "text-emerald-600",
  running: "text-teal-600 animate-spin",
  pending: "text-slate-300",
  skipped: "text-slate-400",
  failed: "text-rose-600"
};

const TEXT_STYLE: Record<StageStatus, string> = {
  done: "text-slate-700",
  running: "font-medium text-slate-950",
  pending: "text-slate-400",
  skipped: "text-slate-400",
  failed: "text-rose-700"
};

function Counter({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border bg-white px-3 py-2 text-center">
      <p className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

export function SearchProgressPanel({ progress }: { progress: SearchProgressData }) {
  const { counters } = progress;
  const hasCounters = counters.found + counters.verified + counters.eliminated + counters.eligible > 0;

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {progress.stages.map((stage) => {
          const Icon = STATUS_ICON[stage.status];

          return (
            <li key={stage.key} className="flex items-start gap-2 text-sm leading-6">
              <Icon className={cn("mt-1 h-3.5 w-3.5 shrink-0", STATUS_STYLE[stage.status])} />
              <span className={cn("min-w-0", TEXT_STYLE[stage.status])}>
                {stage.label}
                {stage.detail ? <span className="text-slate-500"> — {stage.detail}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>

      {hasCounters ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Counter label="bulunan" value={counters.found} tone="text-slate-700" />
          <Counter label="doğrulanan" value={counters.verified} tone="text-teal-700" />
          <Counter label="elenen" value={counters.eliminated} tone="text-slate-500" />
          <Counter label="uygun" value={counters.eligible} tone="text-emerald-700" />
        </div>
      ) : null}
    </div>
  );
}
