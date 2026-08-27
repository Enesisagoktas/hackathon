"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Otomatik başvuru: tek bir açma/kapama kutusu.
 *
 * Eski sürümde bunun yerine 17 kontrollü bir ayar paneli vardı (SMTP sunucu,
 * port, üç ayrı eşik sayısı...). Artık:
 * - Gönderen adı hesabından, gönderen e-postası girdiğin adresten alınır.
 * - SMTP sunucu/port e-posta alan adından otomatik bulunur (Gmail, Outlook,
 *   Yandex, Yahoo, iCloud). Bilinmeyen alan adında iki küçük alan açılır.
 * - Eşikler sunucu varsayılanlarıyla çalışır: 80+ puan otomatik, günde en
 *   fazla 10 başvuru.
 * Kutu ilk kez işaretlendiğinde yalnızca e-posta + uygulama şifresi sorulur.
 */

type SettingsState = {
  autoApplyEnabled: boolean;
  autoApplyMinScore: number;
  dailySendLimit: number;
  hasSmtpPassword: boolean;
  senderEmail?: string;
  smtpHost?: string;
};

/** Yaygın sağlayıcıların SMTP değerleri; alan adından otomatik seçilir. */
const SMTP_BY_DOMAIN: Record<string, { host: string; port: number; secure: boolean }> = {
  "gmail.com": { host: "smtp.gmail.com", port: 465, secure: true },
  "googlemail.com": { host: "smtp.gmail.com", port: 465, secure: true },
  "outlook.com": { host: "smtp.office365.com", port: 587, secure: false },
  "hotmail.com": { host: "smtp.office365.com", port: 587, secure: false },
  "live.com": { host: "smtp.office365.com", port: 587, secure: false },
  "msn.com": { host: "smtp.office365.com", port: 587, secure: false },
  "yandex.com": { host: "smtp.yandex.com.tr", port: 465, secure: true },
  "yandex.com.tr": { host: "smtp.yandex.com.tr", port: 465, secure: true },
  "yandex.ru": { host: "smtp.yandex.com.tr", port: 465, secure: true },
  "yahoo.com": { host: "smtp.mail.yahoo.com", port: 465, secure: true },
  "icloud.com": { host: "smtp.mail.me.com", port: 587, secure: false },
  "me.com": { host: "smtp.mail.me.com", port: 587, secure: false }
};

export function AutoApplyToggle({ userFullName }: { userFullName?: string }) {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [customHost, setCustomHost] = useState("");
  const [customPort, setCustomPort] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/apply");
      if (!response.ok) return;
      const data = await response.json();
      setSettings(data.settings);
      if (data.settings?.senderEmail) {
        setEmail(data.settings.senderEmail);
      }
    } catch {
      // Ayarlar okunamazsa kutu görünmez; sayfa çalışmaya devam eder.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const domain = email.includes("@") ? email.split("@")[1]?.toLowerCase().trim() : "";
  const knownSmtp = domain ? SMTP_BY_DOMAIN[domain] : undefined;
  const needsCustomSmtp = Boolean(domain) && !knownSmtp;

  async function putSettings(body: Record<string, unknown>) {
    const response = await fetch("/api/settings/apply", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message ?? "Ayar kaydedilemedi.");
    }
    setSettings(data.settings);
  }

  async function handleToggle(checked: boolean) {
    if (!settings) return;
    setMessage(null);

    // Kapatmak her zaman tek tık.
    if (!checked) {
      try {
        await putSettings({ autoApplyEnabled: false });
      } catch (error) {
        setMessage({ tone: "error", text: error instanceof Error ? error.message : "Kapatılamadı." });
      }
      return;
    }

    // Açarken: SMTP zaten kayıtlıysa tek tık; değilse mini form.
    if (settings.hasSmtpPassword && settings.senderEmail) {
      try {
        await putSettings({ autoApplyEnabled: true });
      } catch (error) {
        setMessage({ tone: "error", text: error instanceof Error ? error.message : "Açılamadı." });
      }
      return;
    }

    setShowForm(true);
  }

  async function handleSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const smtp = knownSmtp ?? {
      host: customHost.trim(),
      port: Number(customPort) || 465,
      secure: (Number(customPort) || 465) === 465
    };

    if (!email.includes("@") || !password || !smtp.host) {
      setMessage({ tone: "error", text: "E-posta ve uygulama şifresi gerekli." });
      return;
    }

    setIsSaving(true);

    try {
      await putSettings({
        autoApplyEnabled: true,
        senderName: userFullName,
        senderEmail: email.trim(),
        smtpUser: email.trim(),
        smtpHost: smtp.host,
        smtpPort: smtp.port,
        smtpSecure: smtp.secure,
        smtpPassword: password
      });
      setShowForm(false);
      setPassword("");
      setMessage({ tone: "ok", text: "Otomatik başvuru açıldı. 80+ puanlı eşleşmeler senin adına gönderilecek." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Kurulum tamamlanamadı." });
    } finally {
      setIsSaving(false);
    }
  }

  if (!settings) {
    return null;
  }

  return (
    <div className="rounded-2xl border bg-white/90 px-4 py-3">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          checked={settings.autoApplyEnabled}
          className="mt-1 h-4 w-4 shrink-0 accent-teal-600"
          type="checkbox"
          onChange={(event) => void handleToggle(event.target.checked)}
        />
        <span className="text-sm leading-6 text-slate-700">
          <span className="font-medium text-slate-900">
            <Zap className="mr-1 inline h-4 w-4 text-teal-600" />
            Uygun başvuruları otomatik gönder
          </span>
          <span className="block text-slate-500">
            {settings.autoApplyMinScore}+ puanlı eşleşmelerde, ilanda başvuru e-postası varsa CV&apos;n ve ön yazın
            senin adına gönderilir (günde en fazla {settings.dailySendLimit}). Diğer her şey onayına düşer.
          </span>
        </span>
      </label>

      {showForm ? (
        <form className="mt-3 space-y-3 rounded-xl border bg-slate-50/70 p-4" onSubmit={handleSetup}>
          <p className="text-sm leading-6 text-slate-600">
            Başvurular <strong>senin e-posta adresinden</strong> gönderilir. Bunun için bir kere e-posta adresini ve
            uygulama şifreni girmen yeterli — gerisi otomatik.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              placeholder="E-posta adresin"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Input
              placeholder="Uygulama şifresi"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {domain === "gmail.com" || domain === "googlemail.com" ? (
            <p className="text-xs leading-5 text-slate-500">
              Gmail normal şifreni kabul etmez: Google hesabında 2 adımlı doğrulamayı açıp{" "}
              <strong>16 haneli uygulama şifresi</strong> üret (myaccount.google.com → Güvenlik).
            </p>
          ) : null}

          {needsCustomSmtp ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="SMTP sunucusu (örn. mail.firma.com)"
                value={customHost}
                onChange={(event) => setCustomHost(event.target.value)}
              />
              <Input
                placeholder="Port (465 veya 587)"
                value={customPort}
                onChange={(event) => setCustomPort(event.target.value)}
              />
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button disabled={isSaving} size="sm" type="submit">
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Aç ve kaydet
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setShowForm(false)}>
              Vazgeç
            </Button>
          </div>
        </form>
      ) : null}

      {message ? (
        <p
          className={`mt-2 flex items-start gap-2 text-sm ${
            message.tone === "ok" ? "text-teal-700" : "text-red-700"
          }`}
        >
          {message.tone === "ok" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
