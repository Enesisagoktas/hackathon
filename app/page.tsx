import { CvUpload } from "@/components/CvUpload";

/**
 * Tek kolonlu, sade kabuk.
 *
 * Eskiden burada iki kolonlu bir yerleşim vardı: solda pazarlama metni, dört
 * adet "nasıl çalışır" kartı ve uzun bir gizlilik kartı; sağda ise gerçek
 * uygulama. Bu kartlar altındaki akışı zaten tekrar ettiği için sayfa 6,6 ekran
 * boyuna çıkıyordu. Artık akışın kendisi adım adım ilerliyor, açıklamaya gerek
 * kalmıyor.
 */
export default function Home() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#f1f7f6_100%)]">
      <div className="container max-w-3xl py-8 md:py-12">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">CVMatch</h1>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            CV&apos;ni yükle; sana uygun ilanları bulalım, her ilan için CV&apos;ni yeniden yazalım ve başvurusunu
            yapalım.
          </p>
        </header>

        <CvUpload />

        <footer className="mt-10 border-t pt-4 text-xs leading-5 text-slate-500">
          CV metnin hesabına bağlı olarak saklanır, istediğin an silebilirsin. Uyarlanan CV&apos;ye sende olmayan
          beceri eklenmez; eksikler ayrı raporda gösterilir.
        </footer>
      </div>
    </main>
  );
}
