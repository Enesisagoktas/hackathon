"use client";

import { Building2, Home, Laptop, Shuffle } from "lucide-react";

import type { WorkMode } from "@/lib/search-preferences";
import { cn } from "@/lib/utils";

type WorkModeSelectorProps = {
  value: WorkMode;
  onChange: (value: WorkMode) => void;
};

const WORK_MODE_OPTIONS = [
  {
    value: "any",
    label: "Fark etmez",
    description: "Tüm çalışma modellerini dahil et.",
    icon: Shuffle
  },
  {
    value: "remote",
    label: "Uzaktan",
    description: "Remote, uzaktan ve home office ilanları hedefle.",
    icon: Home
  },
  {
    value: "hybrid",
    label: "Hibrit",
    description: "Hibrit çalışma içeren ilanları öne çıkar.",
    icon: Laptop
  },
  {
    value: "onsite",
    label: "Ofisten",
    description: "Ofis veya onsite çalışma ifadelerini kullan.",
    icon: Building2
  }
] as const;

export function WorkModeSelector({ value, onChange }: WorkModeSelectorProps) {
  return (
    <div className="rounded-3xl border bg-white/80 p-5 shadow-sm">
      <div>
        <p className="text-sm font-semibold text-slate-900">Çalışma Modeli</p>
        <p className="mt-1 text-sm text-slate-500">Uzaktan çalışma dahil edilsin veya belirli bir modeli hedefleyin.</p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {WORK_MODE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = value === option.value;

          return (
            <button
              key={option.value}
              className={cn(
                "rounded-2xl border p-4 text-left transition hover:border-teal-300 hover:bg-teal-50/70",
                isSelected ? "border-teal-500 bg-teal-50 text-teal-950" : "bg-white text-slate-700"
              )}
              type="button"
              onClick={() => onChange(option.value)}
            >
              <span className="flex items-center gap-2 font-semibold">
                <Icon className="h-4 w-4 text-teal-700" />
                {option.label}
              </span>
              <span className="mt-1 block text-sm text-slate-500">{option.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
