"use client";

import { useMemo, useState } from "react";
import { MapPin, Search, X } from "lucide-react";

import type { LocationMode } from "@/lib/search-preferences";
import { POPULAR_TURKEY_CITIES, TURKEY_CITIES } from "@/lib/turkey-cities";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LocationSelectorProps = {
  locationMode: LocationMode;
  selectedCities: string[];
  onLocationModeChange: (mode: LocationMode) => void;
  onCitiesChange: (cities: string[]) => void;
};

export function LocationSelector({
  locationMode,
  selectedCities,
  onLocationModeChange,
  onCitiesChange
}: LocationSelectorProps) {
  const [citySearch, setCitySearch] = useState("");
  const selectedCitySet = useMemo(() => new Set(selectedCities), [selectedCities]);
  const filteredCities = useMemo(() => {
    const query = citySearch.toLocaleLowerCase("tr-TR").trim();

    if (!query) {
      return TURKEY_CITIES;
    }

    return TURKEY_CITIES.filter((city) => city.toLocaleLowerCase("tr-TR").includes(query));
  }, [citySearch]);

  function toggleCity(city: string) {
    if (selectedCitySet.has(city)) {
      onCitiesChange(selectedCities.filter((selectedCity) => selectedCity !== city));
      return;
    }

    onCitiesChange([...selectedCities, city]);
  }

  function addCities(cities: readonly string[]) {
    onCitiesChange(Array.from(new Set([...selectedCities, ...cities])));
  }

  return (
    <div className="rounded-3xl border bg-white/80 p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <MapPin className="h-4 w-4 text-teal-700" />
            Lokasyon Tercihi
          </div>
          <p className="mt-1 text-sm text-slate-500">Türkiye geneli arayın veya istediğiniz illeri seçin.</p>
        </div>
        {locationMode === "cities" ? (
          <Badge className="w-fit border-teal-200 bg-teal-50 text-teal-700" variant="outline">
            {selectedCities.length} il seçili
          </Badge>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          className={cn(
            "rounded-2xl border p-4 text-left transition hover:border-teal-300 hover:bg-teal-50/70",
            locationMode === "all-turkey" ? "border-teal-500 bg-teal-50 text-teal-950" : "bg-white text-slate-700"
          )}
          type="button"
          onClick={() => onLocationModeChange("all-turkey")}
        >
          <span className="font-semibold">Tüm Türkiye</span>
          <span className="mt-1 block text-sm text-slate-500">Sorgular Türkiye genelinde üretilir.</span>
        </button>
        <button
          className={cn(
            "rounded-2xl border p-4 text-left transition hover:border-teal-300 hover:bg-teal-50/70",
            locationMode === "cities" ? "border-teal-500 bg-teal-50 text-teal-950" : "bg-white text-slate-700"
          )}
          type="button"
          onClick={() => onLocationModeChange("cities")}
        >
          <span className="font-semibold">İl seç</span>
          <span className="mt-1 block text-sm text-slate-500">Birden fazla il için hedefli arama yapılır.</span>
        </button>
      </div>

      {locationMode === "cities" ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-9"
                value={citySearch}
                onChange={(event) => setCitySearch(event.target.value)}
                placeholder="İl ara"
              />
            </div>
            <Button type="button" variant="outline" onClick={() => addCities(POPULAR_TURKEY_CITIES)}>
              Popüler İller
            </Button>
            <Button type="button" variant="ghost" onClick={() => onCitiesChange([])}>
              Temizle
            </Button>
          </div>

          {selectedCities.length ? (
            <div className="flex flex-wrap gap-2">
              {selectedCities.map((city) => (
                <button
                  key={city}
                  className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800"
                  type="button"
                  onClick={() => toggleCity(city)}
                >
                  {city}
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed bg-slate-50 p-3 text-sm text-slate-500">
              İl seçimi boşsa iş araması yapmadan önce en az bir il seçmeniz gerekir.
            </p>
          )}

          <div className="grid max-h-64 gap-2 overflow-auto rounded-2xl border bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCities.map((city) => {
              const isSelected = selectedCitySet.has(city);

              return (
                <button
                  key={city}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-left text-sm transition",
                    isSelected
                      ? "border-teal-500 bg-teal-600 font-medium text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-teal-300 hover:bg-teal-50"
                  )}
                  type="button"
                  onClick={() => toggleCity(city)}
                >
                  {city}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
