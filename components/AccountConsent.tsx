"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, LogOut, Settings2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type RegisteredUser = {
  id: number;
  fullName: string;
  email: string;
};

type AccountConsentProps = {
  onUserChange: (user: RegisteredUser | null) => void;
  /** Verilirse giriş sonrası şeritte "Ayarlar" tuşu görünür. */
  onOpenSettings?: () => void;
};

type Mode = "register" | "login";

/**
 * Giriş / kayıt ve KVKK onayı.
 *
 * Kimlik artık localStorage'da değil, sunucunun imzaladığı HttpOnly oturum
 * çerezinde tutulur. Misafir modu kaldırıldı: sistem kullanıcı adına gerçek
 * e-posta gönderdiği ve CV'sini sakladığı için "bu kim" sorusunun doğrulanabilir
 * bir cevabı olmak zorunda.
 */
export function AccountConsent({ onUserChange, onOpenSettings }: AccountConsentProps) {
  const [user, setUser] = useState<RegisteredUser | null>(null);
  const [mode, setMode] = useState<Mode>("register");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [kvkkAccepted, setKvkkAccepted] = useState(false);
  const [explicitConsentAccepted, setExplicitConsentAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(true);

  const applyUser = useCallback(
    (nextUser: RegisteredUser | null) => {
      setUser(nextUser);
      onUserChange(nextUser);
    },
    [onUserChange]
  );

  // Sayfa açılışında sunucudaki oturumu sor.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/auth/me");
        const data = await response.json();

        if (!cancelled && data.user) {
          applyUser(data.user);
        }
      } catch {
        // Oturum okunamadıysa giriş formu gösterilir.
      } finally {
        if (!cancelled) {
          setIsLoadingSession(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyUser]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (mode === "register" && (!kvkkAccepted || !explicitConsentAccepted)) {
      setError("Devam etmek için KVKK aydınlatma metni ve açık rıza onaylarını kabul edin.");
      return;
    }

    setIsSubmitting(true);

    try {
      const endpoint = mode === "register" ? "/api/register" : "/api/auth/login";
      const body =
        mode === "register"
          ? { fullName, email, password, kvkkAccepted, explicitConsentAccepted }
          : { email, password };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "İşlem tamamlanamadı.");
      }

      applyUser(data.user);
      setPassword("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "İşlem sırasında hata oluştu.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    applyUser(null);
    setPassword("");
  }

  if (isLoadingSession) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Oturum kontrol ediliyor...
      </div>
    );
  }

  // Giriş yapıldıktan sonra hesap bilgisi tek satırlık ince bir şerit olur.
  // Eskiden burada koca bir kart duruyordu; oysa oturum açıkken kullanıcının
  // görmesi gereken tek şey kim olarak giriş yaptığı ve çıkış tuşu.
  if (user) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-white/80 px-3 py-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-600" />
          <span className="truncate font-medium text-slate-900">{user.fullName}</span>
          <span className="hidden truncate text-slate-500 sm:inline">{user.email}</span>
        </span>

        <span className="flex shrink-0 items-center gap-1">
          {onOpenSettings ? (
            <Button size="sm" type="button" variant="ghost" onClick={onOpenSettings}>
              <Settings2 className="mr-1.5 h-4 w-4" />
              Ayarlar
            </Button>
          ) : null}
          <Button size="sm" type="button" variant="ghost" onClick={handleLogout}>
            <LogOut className="mr-1.5 h-4 w-4" />
            Çıkış
          </Button>
        </span>
      </div>
    );
  }

  return (
    <Card className="border-amber-100 bg-white/90 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-teal-700" />
          {mode === "register" ? "Hesap Oluştur ve KVKK Onayı" : "Giriş Yap"}
        </CardTitle>
        <CardDescription>
          {mode === "register"
            ? "Sistem CV'nizi ilanlara göre yeniden yazıp sizin adınıza başvuru gönderdiği için hesap zorunludur."
            : "Kayıtlı hesabınızla giriş yapın."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="space-y-4" onSubmit={handleSubmit}>
          {mode === "register" ? (
            <Input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Ad Soyad"
              autoComplete="name"
            />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="E-posta"
              type="email"
              autoComplete="email"
            />
            <Input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Şifre (en az 8 karakter)"
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
          </div>

          {mode === "register" ? (
            <div className="space-y-3">
              <label className="flex gap-3 rounded-2xl border bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                <input
                  className="mt-1 h-4 w-4 shrink-0"
                  checked={kvkkAccepted}
                  type="checkbox"
                  onChange={(event) => setKvkkAccepted(event.target.checked)}
                />
                <span>
                  KVKK aydınlatma metnini okudum. CV metnimin, ilana özel CV üretilebilmesi için hesabıma bağlı olarak
                  <strong> saklanacağını</strong> ve dilediğim an tek tuşla silebileceğimi anladım.
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
                  CV analizi, ilana özel CV uyarlaması ve <strong>onayladığım başvuruların adıma gönderilmesi</strong>{" "}
                  için açık rıza veriyorum.
                </span>
              </label>
            </div>
          ) : null}

          {error ? <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

          <Button className="w-full" disabled={isSubmitting} size="lg" type="submit">
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {mode === "register" ? "Hesap Oluştur ve Devam Et" : "Giriş Yap"}
          </Button>
        </form>

        <button
          className="w-full text-center text-sm text-teal-700 underline-offset-2 hover:underline"
          type="button"
          onClick={() => {
            setMode(mode === "register" ? "login" : "register");
            setError(null);
          }}
        >
          {mode === "register" ? "Zaten hesabım var, giriş yap" : "Hesabım yok, kayıt ol"}
        </button>
      </CardContent>
    </Card>
  );
}
