import { TURKEY_CITIES } from "@/lib/turkey-cities";

export type LocationMode = "all-turkey" | "cities";
export type WorkMode = "any" | "remote" | "hybrid" | "onsite";

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  any: "Fark etmez",
  remote: "Uzaktan",
  hybrid: "Hibrit",
  onsite: "Ofisten"
};

export function normalizeLocationMode(value: unknown): LocationMode {
  return value === "cities" ? "cities" : "all-turkey";
}

export function normalizeWorkMode(value: unknown): WorkMode {
  if (value === "remote" || value === "hybrid" || value === "onsite") {
    return value;
  }

  return "any";
}

export function normalizeCities(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const allowedCities = new Set<string>(TURKEY_CITIES);
  const normalized = value.filter((city): city is string => typeof city === "string" && allowedCities.has(city));

  return Array.from(new Set(normalized));
}

export function getWorkModeSearchTerms(workMode: WorkMode) {
  if (workMode === "remote") {
    return ["uzaktan", "remote", "remote work", "home office"];
  }

  if (workMode === "hybrid") {
    return ["hibrit", "hybrid"];
  }

  if (workMode === "onsite") {
    return ["ofisten", "ofis", "onsite"];
  }

  return [];
}

export function getWorkModeDisplay(workMode: WorkMode) {
  return WORK_MODE_LABELS[workMode];
}
