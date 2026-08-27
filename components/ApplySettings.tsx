"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Mail, Settings2, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type ApplySettingsData = {
  autoApplyEnabled: boolean;
  autoApplyMinScore: number;
  dailySendLimit: number;
  minPrepareScore: number;
  senderName?: string;
  senderEmail?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure: boolean;
  smtpUser?: string;
  hasSmtpPassword: boolean;
  smtpVerifiedAt?: string;
  ccSelf: boolean;
};

/** Yaygın sağlayıcılar için hazır SMTP değerleri. */
const PRESETS: Array<{ label: string; host: string; port: number; secure: boolean; hint: string }> = [
  {
    label: "Gmail",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    hint: "Gmail normal şifreyi kabul etmez. Google hesabınızda 2 adımlı doğrulamayı açıp 16 haneli bir Uygulama Şifresi üretin."
  },
  {
    label: "Outlook / Microsoft 365",
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    hint: "Microsoft 365 hesaplarında SMTP AUTH'un yönetici tarafından açık olması gerekir."
  },
  {
    label: "Yandex",
    host: "smtp.yandex.com.tr",
    port: 465,
    secure: true,
    hint: "Yandex'te de uygulama şifresi kullanmanız gerekir."
  }
];

export function ApplySettings({ onSettingsChange }: { onSettingsChange?: (settings: ApplySettingsData) => void }) {
  const [settings, setSettings] = useState<ApplySettingsData | null>(null);
  const [appSecretConfigured, setAppSecretConfigured] = useState(true);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [smtpPassword, setSmtpPassword] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/apply");

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      setSettings(data.settings);
      setAppSecretConfigured(data.appSecretConfigured !== false);
      setAiConfigured(data.aiConfigured !== false);
      onSettingsChange?.(data.settings);
    } catch {
      // Ayarlar okunamadıysa varsayılanlarla devam edilir.
    } finally {
      setIsLoading(false);
    }
  }, [onSettingsChange]);

  useEffect(() => {
    void load();
  }, [load]);

  function update(patch: Partial<ApplySettingsData>) {
    setSettings((current) => (current ? { ...current, ...patch } : current));
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!settings) {
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/settings/apply", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          // Şifre yalnızca yeni bir değer girildiyse gönderilir.
          smtpPassword: smtpPassword || undefined
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? "Ayarlar kaydedilemedi.");
      }

      setSettings(data.settings);
      onSettingsChange?.(data.settings);
      setSmtpPassword("");
      setMessage({ tone: "ok", text: data.message ?? "Ayarlar kaydedildi." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Ayarlar kaydedilemedi." });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleVerify() {
    setIsVerifying(true);
    setMessage(null);

    try {
      const response = await fetch("/api/settings/apply/verify", { method: "POST" });
      const data = await response.json();

      setMessage({
        tone: response.ok ? "ok" : "error",
        text: data.message ?? (response.ok ? "SMTP bağlantısı doğrulandı." : "SMTP doğrulanamadı.")
      });

      if (response.ok) {
        await load();
      }
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "SMTP doğrulanamadı." });
    } finally {
      setIsVerifying(false);
    }
  }

  if (isLoading || !settings) {
    return null;
  }

  const autoApplyReady = Boolean(settings.smtpHost && settings.smtpUser && settings.senderEmail && settings.hasSmtpPassword);

  return (
    <Card className="border-slate-200 bg-white/90 shadow-sm">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Settings2 className="h-5 w-5 text-teal-700" />
              Otomatik Başvuru Ayarları
            </CardTitle>
            <CardDescription className="mt-2">
              {settings.autoApplyEnabled ? (
                <>
                  <strong className="text-teal-700">Açık.</strong> {settings.autoApplyMinScore} puan ve üstü eşleşmelerde,
                  ilanda başvuru e-postası varsa başvuru otomatik gönderilir (günlük en fazla {settings.dailySendLimit}).
                </>
              ) : (
                <>
                  <strong className="text-slate-700">Kapalı.</strong> Başvuru paketleri hazırlanır ama hiçbir e-posta
                  onayınız olmadan gönderilmez.
                </>
              )}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {settings.autoApplyEnabled ? (
              <Badge className="border-teal-200 bg-teal-50 text-teal-700" variant="outline">
                Otomatik
              </Badge>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setIsOpen(!isOpen)}>
              {isOpen ? "Kapat" : "Düzenle"}
            </Button>
          </div>
        </div>
      </CardHeader>

      {!aiConfigured ? (
        <CardContent className="pt-0">
          <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <strong>GEMINI_API_KEY tanımlı değil.</strong> Sistem çalışır ama düşürülmüş modda: ilan eşleştirme ve
              CV uyarlaması AI yerine anahtar kelime kurallarıyla yapılır, eşleşme skorları 55&apos;in üstüne çıkamaz.
              Bu yüzden <strong>hiçbir başvuru otomatik gönderilmez</strong> — hepsi onayınıza düşer. Tam kapasite
              için <code className="mx-1 rounded bg-amber-100 px-1">.env</code> dosyasına Google AI Studio anahtarınızı
              ekleyin.
            </p>
          </div>
        </CardContent>
      ) : null}

      {isOpen ? (
        <CardContent>
          {!appSecretConfigured ? (
            <div className="mb-4 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <strong>APP_SECRET tanımlı değil.</strong> SMTP şifresi güvenle şifrelenemediği için kaydedilemez.
                <code className="mx-1 rounded bg-amber-100 px-1">.env</code> dosyasına en az 32 karakterlik bir
                APP_SECRET ekleyip sunucuyu yeniden başlatın.
              </p>
            </div>
          ) : null}

          <form className="space-y-6" onSubmit={handleSave}>
            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-900">Gönderim kuralları</h3>

              <label className="flex gap-3 rounded-2xl border bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                <input
                  className="mt-1 h-4 w-4 shrink-0"
                  checked={settings.autoApplyEnabled}
                  disabled={!autoApplyReady}
                  type="checkbox"
                  onChange={(event) => update({ autoApplyEnabled: event.target.checked })}
                />
                <span>
                  Eşik üstü eşleşmelerde başvuruyu <strong>otomatik gönder</strong>.
                  {!autoApplyReady ? (
                    <span className="mt-1 block text-amber-700">
                      Önce aşağıdaki SMTP alanlarını doldurup kaydedin.
                    </span>
                  ) : null}
                </span>
              </label>

              <div className="grid gap-4 sm:grid-cols-3">
                <NumberField
                  label="Otomatik gönderim eşiği"
                  hint="Bu puanın altındakiler onay bekler."
                  value={settings.autoApplyMinScore}
                  min={50}
                  max={100}
                  onChange={(value) => update({ autoApplyMinScore: value })}
                />
                <NumberField
                  label="Günlük gönderim tavanı"
                  hint="Yanlış eşleşmede zararı sınırlar."
                  value={settings.dailySendLimit}
                  min={0}
                  max={50}
                  onChange={(value) => update({ dailySendLimit: value })}
                />
                <NumberField
                  label="Paket hazırlama eşiği"
                  hint="Bu puanın altına CV bile uyarlanmaz."
                  value={settings.minPrepareScore}
                  min={0}
                  max={100}
                  onChange={(value) => update({ minPrepareScore: value })}
                />
              </div>

              <label className="flex gap-3 rounded-2xl border bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                <input
                  className="mt-1 h-4 w-4 shrink-0"
                  checked={settings.ccSelf}
                  type="checkbox"
                  onChange={(event) => update({ ccSelf: event.target.checked })}
                />
                <span>Gönderilen her başvurunun bir kopyasını kendime CC olarak at.</span>
              </label>
            </section>

            <section className="space-y-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Mail className="h-4 w-4 text-teal-700" />
                Gönderen hesap (SMTP)
              </h3>
              <p className="text-sm leading-6 text-slate-500">
                Başvurular sizin kendi e-posta hesabınızdan çıkar, sistemin ortak adresinden değil. Böylece işverenin
                &quot;Yanıtla&quot; tuşu doğrudan size döner.
              </p>

              <div className="flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => update({ smtpHost: preset.host, smtpPort: preset.port, smtpSecure: preset.secure })}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>

              {PRESETS.find((preset) => preset.host === settings.smtpHost) ? (
                <p className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm leading-6 text-sky-800">
                  {PRESETS.find((preset) => preset.host === settings.smtpHost)?.hint}
                </p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Gönderen adı"
                  value={settings.senderName ?? ""}
                  placeholder="Ada Lovelace"
                  onChange={(value) => update({ senderName: value })}
                />
                <TextField
                  label="Gönderen e-posta"
                  value={settings.senderEmail ?? ""}
                  placeholder="ada@example.com"
                  type="email"
                  onChange={(value) => update({ senderEmail: value })}
                />
                <TextField
                  label="SMTP sunucusu"
                  value={settings.smtpHost ?? ""}
                  placeholder="smtp.gmail.com"
                  onChange={(value) => update({ smtpHost: value })}
                />
                <TextField
                  label="SMTP portu"
                  value={settings.smtpPort ? String(settings.smtpPort) : ""}
                  placeholder="465"
                  onChange={(value) => update({ smtpPort: Number(value) || undefined })}
                />
                <TextField
                  label="SMTP kullanıcı adı"
                  value={settings.smtpUser ?? ""}
                  placeholder="ada@example.com"
                  onChange={(value) => update({ smtpUser: value })}
                />
                <TextField
                  label={settings.hasSmtpPassword ? "SMTP şifresi (kayıtlı — değiştirmek için yazın)" : "SMTP şifresi"}
                  value={smtpPassword}
                  placeholder={settings.hasSmtpPassword ? "••••••••" : "Uygulama şifresi"}
                  type="password"
                  onChange={setSmtpPassword}
                />
              </div>

              <label className="flex gap-3 text-sm text-slate-700">
                <input
                  className="mt-1 h-4 w-4 shrink-0"
                  checked={settings.smtpSecure}
                  type="checkbox"
                  onChange={(event) => update({ smtpSecure: event.target.checked })}
                />
                <span>SSL/TLS kullan (port 465 için işaretli, port 587 için işaretsiz bırakın).</span>
              </label>

              {settings.smtpVerifiedAt ? (
                <p className="flex items-center gap-2 text-sm text-teal-700">
                  <CheckCircle2 className="h-4 w-4" />
                  SMTP bağlantısı doğrulandı ({new Date(settings.smtpVerifiedAt).toLocaleString("tr-TR")}).
                </p>
              ) : null}
            </section>

            {message ? (
              <div
                className={`flex gap-3 rounded-2xl border p-4 text-sm ${
                  message.tone === "ok"
                    ? "border-teal-200 bg-teal-50 text-teal-800"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                {message.tone === "ok" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <p>{message.text}</p>
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button className="flex-1" disabled={isSaving} type="submit">
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Ayarları Kaydet
              </Button>
              <Button
                className="flex-1"
                disabled={isVerifying || !settings.hasSmtpPassword}
                type="button"
                variant="outline"
                onClick={handleVerify}
              >
                {isVerifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Bağlantıyı Test Et
              </Button>
            </div>
          </form>
        </CardContent>
      ) : null}
    </Card>
  );
}

function TextField({
  label,
  value,
  placeholder,
  type,
  onChange
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <Input value={value} placeholder={placeholder} type={type} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <Input
        max={max}
        min={min}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="block text-xs text-slate-500">{hint}</span>
    </label>
  );
}
