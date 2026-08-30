"use client";

import { useMemo } from "react";

import type { JobSearchResult } from "@/lib/job-search";
import { cn } from "@/lib/utils";

/**
 * §21 — İlan listesi için sade filtre ve sıralama.
 *
 * BİLİNÇLİ OLARAK AZ: şartnamedeki "detaylı ama kullanılmayan onlarca filtre
 * gösterme" kuralı gereği yalnızca kullanıcının gerçekten karar değiştirdiği
 * dört eksen var. Filtreler yalnızca listede KARŞILIĞI OLDUĞUNDA gösterilir;
 * tek seçenekli bir filtre karar değil, gürültüdür.
 */

export type JobFilterState = {
  sort: "uyum" | "guncellik" | "pozisyon";
  location: string;
  workMode: string;
  onlyEligible: boolean;
  /** Feature #4 — kullanıcı eşiği; 0 = tümü. UYGUNLUK SÜZGECİNDEN SONRA uygulanır. */
  minScore: number;
};

export const DEFAULT_FILTERS: JobFilterState = {
  sort: "uyum",
  location: "hepsi",
  workMode: "hepsi",
  // Feature #3 — elenen ilanlar VARSAYILAN GİZLİ gelir; kullanıcı kutuyu
  // açarak gerekçeleriyle görebilir ("elenenleri göster"). Elenenler ana
  // listeyi domine edemez.
  onlyEligible: true,
  minScore: 0
};

/** Şehir adını "İstanbul(Asya) (Ümraniye)" gibi eklerden arındırır. */
export function baseCity(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value.split(/[(\/,]/)[0].trim();
}

export function applyJobFilters(results: JobSearchResult[], filters: JobFilterState): JobSearchResult[] {
  const filtered = results.filter((result) => {
    if (filters.onlyEligible && result.eligibility && !result.eligibility.eligible) {
      return false;
    }

    // Feature #4 — eşik, uygunluk süzgecinden SONRA çalışır ve elenen
    // (gerekçeli) kayıtlara dokunmaz; onları kendi kutusu yönetir.
    if (filters.minScore > 0 && (result.eligibility?.eligible ?? true) && result.matchScore < filters.minScore) {
      return false;
    }

    if (filters.location !== "hepsi" && baseCity(result.location) !== filters.location) {
      return false;
    }

    if (filters.workMode !== "hepsi" && (result.workMode ?? "") !== filters.workMode) {
      return false;
    }

    return true;
  });

  const sorted = [...filtered];

  if (filters.sort === "guncellik") {
    sorted.sort((left, right) => {
      const l = left.postedAt ? Date.parse(left.postedAt) : 0;
      const r = right.postedAt ? Date.parse(right.postedAt) : 0;
      return (Number.isNaN(r) ? 0 : r) - (Number.isNaN(l) ? 0 : l);
    });
  } else if (filters.sort === "pozisyon") {
    sorted.sort((left, right) => (right.eligibility?.roleScore ?? 0) - (left.eligibility?.roleScore ?? 0));
  } else {
    sorted.sort((left, right) => {
      const le = left.eligibility?.eligible ?? true;
      const re = right.eligibility?.eligible ?? true;
      if (le !== re) return le ? -1 : 1;
      return right.matchScore - left.matchScore;
    });
  }

  return sorted;
}

function Segmented({
  value,
  options,
  onChange
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition",
            value === option.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function JobFilters({
  results,
  filters,
  onChange,
  visibleCount
}: {
  results: JobSearchResult[];
  filters: JobFilterState;
  onChange: (next: JobFilterState) => void;
  visibleCount: number;
}) {
  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const result of results) {
      const city = baseCity(result.location);
      if (city) {
        set.add(city);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [results]);

  const workModes = useMemo(() => {
    const set = new Set<string>();
    for (const result of results) {
      if (result.workMode) {
        set.add(result.workMode);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [results]);

  const hasIneligible = results.some((result) => result.eligibility && !result.eligibility.eligible);
  const ineligibleCount = results.filter((result) => result.eligibility && !result.eligibility.eligible).length;

  return (
    <div className="space-y-3 rounded-2xl border bg-white p-3.5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Sırala</span>
        <span className="text-xs text-slate-500">
          {visibleCount} / {results.length} ilan
        </span>
      </div>

      <div className="space-y-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">En az uyum</span>
        <Segmented
          value={String(filters.minScore)}
          onChange={(value) => onChange({ ...filters, minScore: Number(value) })}
          options={[
            { value: "0", label: "Tümü" },
            { value: "70", label: "%70+" },
            { value: "80", label: "%80+" },
            { value: "90", label: "%90+" }
          ]}
        />
      </div>

      <Segmented
        value={filters.sort}
        onChange={(sort) => onChange({ ...filters, sort: sort as JobFilterState["sort"] })}
        options={[
          { value: "uyum", label: "Uyuma göre" },
          { value: "pozisyon", label: "Pozisyon uygunluğu" },
          { value: "guncellik", label: "Güncellik" }
        ]}
      />

      {cities.length > 1 ? (
        <div className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Konum</span>
          <Segmented
            value={filters.location}
            onChange={(location) => onChange({ ...filters, location })}
            options={[{ value: "hepsi", label: "Hepsi" }, ...cities.map((city) => ({ value: city, label: city }))]}
          />
        </div>
      ) : null}

      {workModes.length > 1 ? (
        <div className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Çalışma modeli</span>
          <Segmented
            value={filters.workMode}
            onChange={(workMode) => onChange({ ...filters, workMode })}
            options={[{ value: "hepsi", label: "Hepsi" }, ...workModes.map((mode) => ({ value: mode, label: mode }))]}
          />
        </div>
      ) : null}

      {hasIneligible ? (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={!filters.onlyEligible}
            onChange={(event) => onChange({ ...filters, onlyEligible: !event.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-teal-600"
          />
          Elenen ilanları da göster ({ineligibleCount}) — neden uygun olmadıklarıyla
        </label>
      ) : null}
    </div>
  );
}
