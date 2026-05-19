"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type RegisteredUser = {
  fullName: string;
  email: string;
  kvkkAccepted: boolean;
  explicitConsentAccepted: boolean;
};

type AccountConsentProps = {
  onUserChange: (user: RegisteredUser | null) => void;
};

const STORAGE_KEY = "cvmatch:user";

export function AccountConsent({ onUserChange }: AccountConsentProps) {
  const [user, setUser] = useState<RegisteredUser | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [kvkkAccepted, setKvkkAccepted] = useState(false);
  const [explicitConsentAccepted, setExplicitConsentAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const storedUser = window.localStorage.getItem(STORAGE_KEY);

    if (!storedUser) {
      return;
    }

    try {
      const parsedUser = JSON.parse(storedUser) as RegisteredUser;
      setUser(parsedUser);
      onUserChange(parsedUser);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [onUserChange]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ fullName, email, password, kvkkAccepted, explicitConsentAccepted })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Kayıt oluşturulamadı.");
      }

      setUser(data.user);
      onUserChange(data.user);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data.user));
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : "Kayıt sırasında hata oluştu.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function continueWithoutAccount() {
    if (!kvkkAccepted || !explicitConsentAccepted) {
      setError("Devam etmek için KVKK aydınlatma metni ve açık rıza onaylarını kabul edin.");
      return;
    }

    const guestUser: RegisteredUser = {
      fullName: "Misafir Kullanıcı",
      email: "guest@cvmatch.local",
      kvkkAccepted: true,
      explicitConsentAccepted: true
    };

    setUser(guestUser);
    onUserChange(guestUser);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(guestUser));
  }

  function clearUser() {
    setUser(null);
    onUserChange(null);
    setShowForm(false);
    window.localStorage.removeItem(STORAGE_KEY);
  }

  if (user) {
    return (
      <Card className="border-teal-100 bg-white/90 shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CheckCircle2 className="h-5 w-5 text-teal-600" />
                {user.email === "guest@cvmatch.local" ? "Misafir Olarak Devam Edildi" : "Hesap ve KVKK Onayı Tamam"}
              </CardTitle>
              <CardDescription className="mt-2">
                {user.email === "guest@cvmatch.local"
                  ? "KVKK ve açık rıza onaylanarak devam edildi. CV dosyaları kalıcı olarak saklanmaz."
                  : `${user.fullName} hesabıyla devam ediliyor. CV dosyaları kalıcı olarak saklanmaz.`}
              </CardDescription>
            </div>
            <Button type="button" variant="outline" onClick={clearUser}>
              Değiştir
            </Button>
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-amber-100 bg-white/90 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-teal-700" />
          KVKK Onayı ve Giriş
        </CardTitle>
        <CardDescription>
          CV yüklemeden önce KVKK aydınlatma onayı ve açık rıza gereklidir. Hesap oluşturmadan da devam edebilirsiniz.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex gap-3 rounded-2xl border bg-slate-50 p-4 text-sm leading-6 text-slate-700">
          <input
            className="mt-1 h-4 w-4 shrink-0"
            checked={kvkkAccepted}
            type="checkbox"
            onChange={(event) => setKvkkAccepted(event.target.checked)}
          />
          <span>
            KVKK aydınlatma metnini okudum. CV içeriğimin yalnızca analiz isteği sırasında işleneceğini ve kalıcı
            olarak saklanmayacağını anladım.
          </span>
        </label>

        <label className="flex gap-3 rounded-2xl border bg-slate-50 p-4 text-sm leading-6 text-slate-700">
          <input
            className="mt-1 h-4 w-4 shrink-0"
            checked={explicitConsentAccepted}
            type="checkbox"
            onChange={(event) => setExplicitConsentAccepted(event.target.checked)}
          />
          <span>
            CV analizinin yapılması, beceri çıkarımı ve iş arama önerilerinin hazırlanması için açık rıza veriyorum.
          </span>
        </label>

        {error ? <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            className="w-full"
            type="button"
            onClick={continueWithoutAccount}
            disabled={!kvkkAccepted || !explicitConsentAccepted}
          >
            <User className="mr-2 h-4 w-4" />
            Hesap Oluşturmadan Devam Et
          </Button>
          <Button
            className="w-full"
            type="button"
            variant="outline"
            onClick={() => setShowForm(!showForm)}
          >
            {showForm ? "Formu Kapat" : "Hesap Oluştur (İsteğe Bağlı)"}
          </Button>
        </div>

        {showForm ? (
          <form className="space-y-4 rounded-2xl border bg-white p-4" onSubmit={handleSubmit}>
            <p className="text-sm font-medium text-slate-700">Hesap bilgilerini girerek sonuçlarınızı saklayabilirsiniz.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Ad Soyad" />
              <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="E-posta" type="email" />
            </div>
            <Input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Şifre" type="password" />
            <Button className="w-full" disabled={isSubmitting} type="submit">
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Hesap Oluştur ve Devam Et
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
