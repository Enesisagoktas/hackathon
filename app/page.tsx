"use client";

import { useState } from "react";

import { AccountConsent, type RegisteredUser } from "@/components/AccountConsent";
import { FLOW_STEPS, StepBar } from "@/components/StepBar";
import { UploadCard } from "@/components/UploadCard";

/**
 * Adım 1-2: Giriş ve CV yükleme.
 *
 * Akış sayfalara bölündü: yükleme kuyruğa girince kullanıcı /analiz/[id]
 * sayfasına geçer (skor + pozisyon seçimi), oradan /basvurular sayfasına.
 */
export default function Home() {
  const [user, setUser] = useState<RegisteredUser | null>(null);

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

        <div className="space-y-4">
          <StepBar current={user ? 2 : 1} steps={FLOW_STEPS} />

          <AccountConsent onUserChange={setUser} />

          {user ? <UploadCard /> : null}
        </div>

        <footer className="mt-10 border-t pt-4 text-xs leading-5 text-slate-500">
          CV metnin hesabına bağlı olarak saklanır, istediğin an silebilirsin. Uyarlanan CV&apos;ye sende olmayan
          beceri eklenmez; eksikler ayrı raporda gösterilir.
        </footer>
      </div>
    </main>
  );
}
