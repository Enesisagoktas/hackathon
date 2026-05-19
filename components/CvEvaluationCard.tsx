import type { CvEvaluation } from "@/lib/cv-evaluation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type CvEvaluationCardProps = {
  evaluation: CvEvaluation;
};

const SCORE_LABELS: Array<[keyof CvEvaluation["scoreBreakdown"], string, number]> = [
  ["format", "Format & Sunum", 8],
  ["personalInfo", "Kişisel Bilgiler", 5],
  ["professionalSummary", "Profesyonel Özet", 10],
  ["experience", "İş Deneyimi", 35],
  ["education", "Eğitim", 15],
  ["skills", "Teknik Beceriler", 12],
  ["certificates", "Sertifika & Lisans", 10],
  ["languages", "Dil Becerileri", 5]
];

export function CvEvaluationCard({ evaluation }: CvEvaluationCardProps) {
  return (
    <Card className="bg-white/90 shadow-soft">
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Detaylı CV Değerlendirmesi</CardTitle>
            <CardDescription className="mt-2">
              {evaluation.source === "ai" ? "AI destekli İK analizi" : "Kural tabanlı fallback analizi"} ile CV puanı,
              güçlü alanlar ve geliştirme önerileri.
            </CardDescription>
          </div>
          <div className="rounded-3xl bg-slate-950 px-5 py-4 text-center text-white">
            <p className="text-4xl font-semibold">{evaluation.score}</p>
            <p className="text-xs text-slate-300">/100 · {evaluation.category}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-2xl border bg-slate-50 p-4">
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge className="border-teal-200 bg-teal-50 text-teal-700" variant="outline">
              {evaluation.professionCategory}
            </Badge>
            <Badge className="border-slate-200 bg-white text-slate-700" variant="outline">
              {evaluation.source === "ai" ? "AI" : "Fallback"}
            </Badge>
          </div>
          <p className="text-sm leading-6 text-slate-700">{evaluation.summary}</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {SCORE_LABELS.map(([key, label, max]) => (
            <div key={key} className="rounded-2xl border bg-white p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-slate-800">{label}</span>
                <span className="text-slate-500">
                  {evaluation.scoreBreakdown[key]}/{max}
                </span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-slate-100">
                <div
                  className="h-2 rounded-full bg-teal-600"
                  style={{ width: `${Math.min(100, (evaluation.scoreBreakdown[key] / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <TwoColumnList title="Güçlü Alanlar" leftItems={evaluation.strengths} rightTitle="Eksik Alanlar" rightItems={evaluation.weaknesses} />

        <Section title="CV Puanını Yükseltmek İçin Öneriler" items={evaluation.improvementSuggestions} />

        <div className="grid gap-3 md:grid-cols-3">
          <FitBox title="Kabul İhtimali Yüksek" items={evaluation.fitAnalysis.high} tone="green" />
          <FitBox title="Kabul İhtimali Orta" items={evaluation.fitAnalysis.medium} tone="amber" />
          <FitBox title="Kabul İhtimali Düşük" items={evaluation.fitAnalysis.low} tone="red" />
        </div>

        {evaluation.riskSignals.length ? <Section title="Risk Sinyalleri" items={evaluation.riskSignals} /> : null}
      </CardContent>
    </Card>
  );
}

function TwoColumnList({
  title,
  leftItems,
  rightTitle,
  rightItems
}: {
  title: string;
  leftItems: string[];
  rightTitle: string;
  rightItems: string[];
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Section title={title} items={leftItems} />
      <Section title={rightTitle} items={rightItems} />
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <h3 className="font-semibold text-slate-950">{title}</h3>
      {items.length ? (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
          {items.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">Bu alanda belirgin veri bulunamadı.</p>
      )}
    </div>
  );
}

function FitBox({ title, items, tone }: { title: string; items: string[]; tone: "green" | "amber" | "red" }) {
  const toneClass = {
    green: "border-teal-200 bg-teal-50 text-teal-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900"
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm leading-6">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}
