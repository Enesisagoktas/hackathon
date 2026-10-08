"use client";

import { ChangeEvent, DragEvent, FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, UploadCloud } from "lucide-react";

import type { LocationMode, WorkMode } from "@/lib/search-preferences";
import { cn } from "@/lib/utils";
import { LocationSelector } from "@/components/LocationSelector";
import { WorkModeSelector } from "@/components/WorkModeSelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];

/**
 * Adım 2: CV yükleme.
 *
 * Yükleme başarıyla kuyruğa girince kullanıcı analiz sayfasına yönlenir;
 * ilerleme, pozisyon seçimi ve sonuçlar oradan devam eder. Eski tek sayfalık
 * akışta tüm bu aşamalar aynı ekranda üst üsteydi.
 */
export function UploadCard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [locationMode, setLocationMode] = useState<LocationMode>("all-turkey");
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [workMode, setWorkMode] = useState<WorkMode>("any");
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setError("Devam etmek için PDF veya DOCX formatında bir CV seç.");
      return;
    }

    if (locationMode === "cities" && !selectedCities.length) {
      setError("İl seç modunda en az bir il seçmen gerekiyor.");
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("locationMode", locationMode);
      formData.append("cities", JSON.stringify(selectedCities));
      formData.append("workMode", workMode);

      const response = await fetch("/api/upload-cv", { method: "POST", body: formData });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "CV gönderilemedi.");
      }

      if (data.searchId) {
        router.push(`/analiz/${data.searchId}`);
        return;
      }

      throw new Error("Sunucu arama numarası döndürmedi.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Beklenmeyen bir hata oluştu.");
      setIsUploading(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files?.[0] ?? null);
  }

  function selectFile(selectedFile: File | null) {
    setError(null);

    if (!selectedFile) {
      setFile(null);
      return;
    }

    const looksAccepted =
      ACCEPTED_TYPES.includes(selectedFile.type) ||
      selectedFile.name.toLocaleLowerCase("tr-TR").endsWith(".pdf") ||
      selectedFile.name.toLocaleLowerCase("tr-TR").endsWith(".docx");

    if (!looksAccepted) {
      setFile(null);
      setError("Sadece PDF veya DOCX formatında CV yükleyebilirsin.");
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      setFile(null);
      setError("Dosya boyutu 5 MB sınırını aşamaz.");
      return;
    }

    setFile(selectedFile);
  }

  return (
    <Card className="bg-white/90 shadow-sm">
      <CardContent className="pt-6">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="hidden"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileChange}
          />

          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-slate-50/80 px-6 py-8 text-center transition hover:border-teal-400 hover:bg-teal-50/60",
              isDragging ? "border-teal-500 bg-teal-50" : "border-slate-200"
            )}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <UploadCloud className="mb-2 h-8 w-8 text-teal-600" />
            <span className="font-medium text-slate-900">
              {file ? file.name : "CV dosyanı buraya bırak veya tıkla"}
            </span>
            <span className="mt-1 text-xs text-slate-500">
              {file ? formatFileSize(file.size) : "PDF veya DOCX · en fazla 5 MB"}
            </span>
          </label>

          <details className="rounded-2xl border bg-white px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-800">
              Arama tercihleri
              <span className="ml-2 font-normal text-slate-500">
                ({locationMode === "all-turkey" ? "Tüm Türkiye" : `${selectedCities.length} il`} ·{" "}
                {workMode === "any"
                  ? "fark etmez"
                  : workMode === "remote"
                    ? "uzaktan"
                    : workMode === "hybrid"
                      ? "hibrit"
                      : "ofisten"}
                )
              </span>
            </summary>
            <div className="mt-4 space-y-4">
              <LocationSelector
                locationMode={locationMode}
                selectedCities={selectedCities}
                onLocationModeChange={setLocationMode}
                onCitiesChange={setSelectedCities}
              />
              <WorkModeSelector value={workMode} onChange={setWorkMode} />
            </div>
          </details>

          {error ? (
            <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          ) : null}

          <Button className="w-full" disabled={!file || isUploading} size="lg" type="submit">
            {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isUploading ? "Yükleniyor…" : "CV'yi Analiz Et"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
