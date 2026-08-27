"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  SkipForward,
  Sparkles,
  XCircle
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GapItem, KeywordAlignmentItem, TailoredCv } from "@/lib/cv/types";

type ApplicationStatus =
  | "preparing"
  | "needs_review"
  | "queued"
  | "sent"
  | "manual_required"
  | "skipped"
  | "failed";

type JobApplication = {
  id: number;
  listingTitle: string;
  listingCompany?: string;
  listingLocation?: string;
  listingPlatform?: string;
  listingUrl: string;
  matchScore: number;
  status: ApplicationStatus;
  channel: "email" | "portal";
  recipientEmail?: string;
  tailoredCv?: TailoredCv;
  coverLetter?: string;
  emailSubject?: string;
  gapReport: GapItem[];
  keywordAlignment: KeywordAlignmentItem[];
  tailoringSource: "ai" | "heuristic";
  hasPdf: boolean;
  hasDocx: boolean;
  autoApplied: boolean;
  sentAt?: string;
  errorMessage?: string;
  createdAt: string;
};

type ApplicationEvent = {
  id: number;
  eventType: string;
  message?: string;
  createdAt: string;
};

const STATUS_META: Record<ApplicationStatus, { label: string; className: string; icon: typeof Clock }> = {
  preparing: { label: "Hazırlanıyor", className: "border-slate-200 bg-slate-50 text-slate-600", icon: Loader2 },
  needs_review: { label: "Onay bekliyor", className: "border-amber-200 bg-amber-50 text-amber-700", icon: Clock },
  queued: { label: "Gönderim sırasında", className: "border-sky-200 bg-sky-50 text-sky-700", icon: Clock },
  sent: { label: "Gönderildi", className: "border-teal-200 bg-teal-50 text-teal-700", icon: CheckCircle2 },
  manual_required: { label: "Elle başvuru", className: "border-violet-200 bg-violet-50 text-violet-700", icon: ExternalLink },
  skipped: { label: "Atlandı", className: "border-slate-200 bg-slate-50 text-slate-500", icon: SkipForward },
  failed: { label: "Hata", className: "border-red-200 bg-red-50 text-red-700", icon: XCircle }
};

export function ApplicationsPanel({ refreshToken }: { refreshToken?: number }) {
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [events, setEvents] = useState<ApplicationEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/applications");

      if (response.status === 401) {
        setApplications([]);
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Başvurular okunamadı.");
      }

      setApplications(data.applications ?? []);
      setStats(data.stats ?? {});
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Başvurular okunamadı.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  async function toggleDetail(applicationId: number) {
    if (expandedId === applicationId) {
      setExpandedId(null);
      setEvents([]);
      return;
    }

    setExpandedId(applicationId);
    setEvents([]);

    try {
      const response = await fetch(`/api/applications/${applicationId}`);
      const data = await response.json();

      if (response.ok) {
        setEvents(data.events ?? []);
      }
    } catch {
      // Denetim izi okunamazsa detay yine gösterilir.
    }
  }

  async function runAction(applicationId: number, action: "send" | "skip" | "manual") {
    setBusyId(applicationId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/applications/${applicationId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "İşlem tamamlanamadı.");
      }

      setNotice(data.message ?? "İşlem tamamlandı.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "İşlem tamamlanamadı.");
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading) {
    return null;
  }

  if (!applications.length) {
    return null;
  }

  return (
    <Card className="border-teal-100 bg-white/90 shadow-soft">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-teal-700" />
              Başvurularım
            </CardTitle>
            <CardDescription className="mt-2">
              Her ilan için CV&apos;niz yeniden yazıldı. İlanın istediği ama CV&apos;nizde kanıtı olmayan hiçbir beceri
              eklenmedi — bunlar &quot;eksikler&quot; bölümünde listelendi.
            </CardDescription>
          </div>
          <Button size="sm" type="button" variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Yenile
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <StatChip label="Gönderildi" value={stats.sent ?? 0} tone="teal" />
          <StatChip label="Onay bekliyor" value={stats.needs_review ?? 0} tone="amber" />
          <StatChip label="Elle başvuru" value={stats.manual_required ?? 0} tone="violet" />
          <StatChip label="Hata" value={stats.failed ?? 0} tone="red" />
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {error ? (
          <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        ) : null}

        {notice ? (
          <div className="flex gap-3 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{notice}</p>
          </div>
        ) : null}

        {applications.map((application) => (
          <ApplicationRow
            key={application.id}
            application={application}
            events={expandedId === application.id ? events : []}
            isExpanded={expandedId === application.id}
            isBusy={busyId === application.id}
            onToggle={() => void toggleDetail(application.id)}
            onAction={(action) => void runAction(application.id, action)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ApplicationRow({
  application,
  events,
  isExpanded,
  isBusy,
  onToggle,
  onAction
}: {
  application: JobApplication;
  events: ApplicationEvent[];
  isExpanded: boolean;
  isBusy: boolean;
  onToggle: () => void;
  onAction: (action: "send" | "skip" | "manual") => void;
}) {
  const meta = STATUS_META[application.status];
  const StatusIcon = meta.icon;
  const criticalGaps = application.gapReport.filter((gap) => gap.severity === "critical");

  return (
    <div className="rounded-3xl border bg-white shadow-sm">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={meta.className} variant="outline">
              <StatusIcon className={`mr-1 h-3 w-3 ${application.status === "preparing" ? "animate-spin" : ""}`} />
              {meta.label}
            </Badge>
            <Badge className="border-slate-200 bg-slate-50 text-slate-700" variant="outline">
              {application.matchScore} puan
            </Badge>
            {application.autoApplied ? (
              <Badge className="border-teal-200 bg-teal-50 text-teal-700" variant="outline">
                Otomatik gönderildi
              </Badge>
            ) : null}
            {application.tailoringSource === "heuristic" ? (
              <Badge className="border-slate-200 bg-slate-50 text-slate-500" variant="outline">
                Kural tabanlı uyarlama
              </Badge>
            ) : (
              <Badge className="border-sky-200 bg-sky-50 text-sky-700" variant="outline">
                <Sparkles className="mr-1 h-3 w-3" />
                AI uyarlama
              </Badge>
            )}
          </div>

          <p className="mt-2 truncate font-semibold text-slate-950">{application.listingTitle}</p>
          <p className="text-sm text-slate-500">
            {[application.listingCompany, application.listingLocation, application.listingPlatform]
              .filter(Boolean)
              .join(" · ")}
          </p>

          {application.channel === "email" && application.recipientEmail ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
              <Mail className="h-3.5 w-3.5" />
              {application.recipientEmail}
            </p>
          ) : null}

          {application.errorMessage ? (
            <p className="mt-2 rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              {application.errorMessage}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" type="button" variant="outline" onClick={onToggle}>
            <FileText className="mr-2 h-4 w-4" />
            {isExpanded ? "Gizle" : "CV'yi Gör"}
          </Button>

          {application.status === "needs_review" && application.channel === "email" ? (
            <Button size="sm" disabled={isBusy} type="button" onClick={() => onAction("send")}>
              {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Gönder
            </Button>
          ) : null}

          {application.status === "manual_required" ? (
            <>
              <a href={application.listingUrl} rel="noreferrer noopener" target="_blank">
                <Button size="sm" type="button">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  İlanı Aç
                </Button>
              </a>
              <Button size="sm" disabled={isBusy} type="button" variant="outline" onClick={() => onAction("manual")}>
                Başvurdum
              </Button>
            </>
          ) : null}

          {application.status !== "sent" && application.status !== "skipped" ? (
            <Button size="sm" disabled={isBusy} type="button" variant="ghost" onClick={() => onAction("skip")}>
              <SkipForward className="mr-2 h-4 w-4" />
              Atla
            </Button>
          ) : null}
        </div>
      </div>

      {criticalGaps.length && !isExpanded ? (
        <div className="border-t bg-amber-50/60 px-4 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
          {criticalGaps.length} kritik eksik: {criticalGaps.slice(0, 3).map((gap) => gap.requirement).join(", ")}
        </div>
      ) : null}

      {isExpanded ? (
        <ApplicationDetail application={application} events={events} />
      ) : null}
    </div>
  );
}

function ApplicationDetail({ application, events }: { application: JobApplication; events: ApplicationEvent[] }) {
  const cv = application.tailoredCv;

  return (
    <div className="space-y-5 border-t bg-slate-50/60 p-4">
      <div className="flex flex-wrap gap-2">
        {application.hasPdf ? (
          <a href={`/api/applications/${application.id}/file?format=pdf`}>
            <Button size="sm" type="button" variant="outline">
              <Download className="mr-2 h-4 w-4" />
              PDF indir
            </Button>
          </a>
        ) : null}
        {application.hasDocx ? (
          <a href={`/api/applications/${application.id}/file?format=docx`}>
            <Button size="sm" type="button" variant="outline">
              <Download className="mr-2 h-4 w-4" />
              DOCX indir
            </Button>
          </a>
        ) : null}
        <a href={application.listingUrl} rel="noreferrer noopener" target="_blank">
          <Button size="sm" type="button" variant="ghost">
            <ExternalLink className="mr-2 h-4 w-4" />
            İlana git
          </Button>
        </a>
      </div>

      {cv ? (
        <section className="space-y-3 rounded-2xl border bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-900">Bu ilana uyarlanan CV</h4>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Başlık</p>
            <p className="text-sm text-slate-800">{cv.headline}</p>
          </div>

          {cv.summary ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Özet</p>
              <p className="text-sm leading-6 text-slate-700">{cv.summary}</p>
            </div>
          ) : null}

          {cv.highlightedSkills.length ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                İlanın istediği ve sizde olan beceriler
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {cv.highlightedSkills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-xs text-teal-700"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {cv.adjacentSkills.length ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                İlanda geçmiyor ama ilgilerini çekebilecek becerileriniz
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {cv.adjacentSkills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {cv.experience.length ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Deneyim (ilana göre yeniden sıralandı)
              </p>
              <ul className="mt-1.5 space-y-2">
                {cv.experience.slice(0, 4).map((entry, index) => (
                  <li key={`${entry.role}-${index}`} className="text-sm text-slate-700">
                    <span className="font-medium text-slate-900">{entry.role}</span>
                    {entry.company ? <span className="text-slate-500"> · {entry.company}</span> : null}
                    {entry.bullets.length ? (
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-600">
                        {entry.bullets.slice(0, 3).map((bullet, bulletIndex) => (
                          <li key={bulletIndex}>{bullet}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {application.gapReport.length ? (
        <section className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            İlanın istediği, CV&apos;nizde bulunmayanlar ({application.gapReport.length})
          </h4>
          <p className="text-xs leading-5 text-amber-800">
            Bunlar CV&apos;ye <strong>bilerek eklenmedi</strong>. Uydurulmuş bir beceri mülakatta ortaya çıkar ve
            başvuruyu bitirir. Gerçekten deneyiminiz varsa ana CV&apos;nize ekleyip yeniden yükleyin.
          </p>
          <ul className="space-y-1.5">
            {application.gapReport.slice(0, 8).map((gap, index) => (
              <li key={index} className="text-sm text-amber-900">
                <span
                  className={`mr-2 rounded px-1.5 py-0.5 text-xs ${
                    gap.severity === "critical" ? "bg-amber-200 text-amber-900" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {gap.severity === "critical" ? "kritik" : "artı olur"}
                </span>
                {gap.requirement}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {application.coverLetter ? (
        <section className="rounded-2xl border bg-white p-4">
          <h4 className="mb-2 text-sm font-semibold text-slate-900">Ön yazı</h4>
          {application.emailSubject ? (
            <p className="mb-2 text-xs text-slate-500">Konu: {application.emailSubject}</p>
          ) : null}
          <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">
            {application.coverLetter}
          </pre>
        </section>
      ) : null}

      {events.length ? (
        <section className="rounded-2xl border bg-white p-4">
          <h4 className="mb-2 text-sm font-semibold text-slate-900">Sistem bu başvuruda ne yaptı</h4>
          <ol className="space-y-1.5">
            {events.map((event) => (
              <li key={event.id} className="text-sm text-slate-600">
                <span className="text-xs text-slate-400">
                  {new Date(event.createdAt).toLocaleString("tr-TR")}
                </span>
                {" — "}
                {event.message ?? event.eventType}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: "teal" | "amber" | "violet" | "red" }) {
  const tones = {
    teal: "border-teal-200 bg-teal-50 text-teal-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
    red: "border-red-200 bg-red-50 text-red-700"
  };

  return (
    <span className={`rounded-full border px-3 py-1 text-sm ${tones[tone]}`}>
      {label}: <strong>{value}</strong>
    </span>
  );
}
