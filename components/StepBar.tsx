import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export type StepBarProps = {
  /** 1 tabanlı geçerli adım. */
  current: number;
  steps: string[];
};

/**
 * Sayfanın en üstündeki ince adım göstergesi.
 *
 * Amacı tek: kullanıcı "şu an neredeyim, sırada ne var" sorusunu bir bakışta
 * cevaplayabilsin. Eskiden bunun yerine ana sayfada dört adet açıklama kartı
 * vardı; hem yer kaplıyor hem de altındaki gerçek akışı tekrar ediyordu.
 */
export function StepBar({ current, steps }: StepBarProps) {
  return (
    <ol className="flex items-center gap-2 text-sm">
      {steps.map((label, index) => {
        const stepNumber = index + 1;
        const isDone = stepNumber < current;
        const isActive = stepNumber === current;

        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition",
                isDone && "bg-teal-600 text-white",
                isActive && "bg-slate-900 text-white",
                !isDone && !isActive && "bg-slate-200 text-slate-500"
              )}
            >
              {isDone ? <Check className="h-3.5 w-3.5" /> : stepNumber}
            </span>

            <span
              className={cn(
                "truncate",
                isActive ? "font-medium text-slate-900" : "text-slate-500"
              )}
            >
              {label}
            </span>

            {stepNumber < steps.length ? (
              <span className={cn("hidden h-px flex-1 sm:block", isDone ? "bg-teal-300" : "bg-slate-200")} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
