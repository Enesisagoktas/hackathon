"use client";

import { useEffect, useState } from "react";
import { BarChart3, Check, CircleHelp, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Feature #5 — Beceri piyasa ısı haritası kartı.
 *
 * DİL KURALI: eksik beceri "bilmiyorsun" değil "CV'nde tespit edilmedi"
 * olarak sunulur — kullanıcının bildiği ama yazmadığı beceriler olabilir.
 */

type HeatmapSkill = {
  skill: string;
  count: number;
  share: number;
  status: "present" | "missing" | "partial";
};

type HeatmapPayload = {
  heatmap: { targetRole: string; sampleSize: number; skills: HeatmapSkill[] };
  confident: boolean;
};

export function SkillHeatmapCard({ role }: { role?: string }) {
  const [data, setData] = useState<HeatmapPayload | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || data || loading) {
      return;
    }

    setLoading(true);
    const query = role ? `?rol=${encodeURIComponent(role)}` : "";

    fetch(`/api/skills-heatmap${query}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setData(payload))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, data, loading, role]);

  return (
    <div className="rounded-2xl border bg-white p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-teal-700" />
          <p className="text-sm font-semibold text-slate-900">Piyasa ne istiyor?</p>
        </div>
        <Button size="sm" type="button" variant="ghost" onClick={() => setOpen((value) => !value)}>
          {open ? "Gizle" : "Göster"}
        </Button>
      </div>

      {open ? (
        loading ? (
          <p className="mt-2 text-sm text-slate-500">Cache'teki ilanlar taranıyor…</p>
        ) : data?.heatmap?.skills?.length ? (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-slate-500">
              {data.heatmap.targetRole} için {data.heatmap.sampleSize} aktif ilan incelendi.
              {!data.confident ? " (Az ilan — sonuçlar sınırlı gösterge sayılmalı.)" : ""}
            </p>

            <ul className="grid gap-1 sm:grid-cols-2">
              {data.heatmap.skills.slice(0, 14).map((item) => (
                <li key={item.skill} className="flex items-center gap-2 text-sm">
                  {item.status === "present" ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : item.status === "partial" ? (
                    <CircleHelp className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                  ) : (
                    <X className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  )}
                  <span className="min-w-0 truncate text-slate-700">{item.skill}</span>
                  <span className="ml-auto text-xs tabular-nums text-slate-400">{item.count} ilan</span>
                </li>
              ))}
            </ul>

            <p className="text-xs leading-5 text-slate-400">
              ✓ CV'nde var · ? kısmen eşleşiyor · ✗ CV'nde tespit edilmedi (bilmediğin anlamına
              gelmez — biliyorsan CV'ne eklemen eşleşmeyi güçlendirir).
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Bu meslek için yeterli ilan verisi henüz yok.</p>
        )
      ) : null}
    </div>
  );
}
