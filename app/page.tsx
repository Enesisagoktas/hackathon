import { CvUpload } from "@/components/CvUpload";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.18),transparent_32rem),linear-gradient(135deg,#f8fafc_0%,#eef6f5_42%,#f8fafc_100%)]">
      <section className="container grid gap-10 py-8 md:py-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:py-16">
        <div className="order-2 space-y-8 lg:sticky lg:top-8 lg:order-1">
          <div className="space-y-5">
            <Badge className="border-teal-200 bg-white/80 text-teal-700 shadow-sm" variant="outline">
              Türkiye odaklı CV analizi ve gerçek ilan eşleştirme
            </Badge>
            <div className="space-y-4">
              <h1 className="max-w-2xl text-balance text-4xl font-semibold tracking-tight text-slate-950 md:text-6xl">
                CV’nizi yükleyin, size uygun gerçek iş ilanlarını saniyeler içinde bulalım.
              </h1>
              <p className="max-w-xl text-lg leading-8 text-slate-600">
                CVMatch, PDF veya DOCX CV içeriğinizi AI ile analiz eder; veritabanındaki aktif gerçek ilanlar arasından
                profilinize en uygun olanları skorlar ve doğrudan ilan detay linkleriyle listeler. Canlı tarama beklemezsiniz.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:max-w-xl">
            {[
              ["1", "CV yükle", "PDF/DOCX, en fazla 5 MB."],
              ["2", "AI profil & değerlendirme", "Beceri, rol ve CV puanı çıkar."],
              ["3", "Gerçek ilanları eşleştir", "Doğrudan ilan detay linkleri."]
            ].map(([step, label, hint]) => (
              <div key={step} className="rounded-2xl border bg-white/75 p-4 shadow-sm backdrop-blur">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-teal-600 text-sm font-semibold text-white">
                  {step}
                </div>
                <p className="font-medium text-slate-900">{label}</p>
                <p className="mt-1 text-sm text-slate-500">{hint}</p>
              </div>
            ))}
          </div>

          <div className="rounded-3xl border border-teal-100 bg-white/65 p-5 text-sm leading-6 text-slate-600 shadow-soft backdrop-blur">
            <p className="font-medium text-slate-900">Gizlilik yaklaşımı</p>
            <p className="mt-2">
              CV dosyaları kalıcı olarak saklanmaz. Dosya sadece istek sırasında bellekte okunur ve metne çevrilir.
            </p>
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <CvUpload />
        </div>
      </section>
    </main>
  );
}
