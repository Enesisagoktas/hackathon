import { readFile } from "fs/promises";
import path from "path";

import { escapeHtml } from "@/lib/cv/render-html";
import { getSmtpPassword, markSmtpVerified, type ApplicationSettings } from "@/lib/apply/settings";

/**
 * Başvuru e-postasının gönderimi.
 *
 * E-posta kullanıcının KENDİ SMTP hesabından çıkar; sistemin ortak bir
 * gönderen adresi yoktur. Böylece işverenin "Yanıtla" tuşu doğrudan
 * kullanıcıya döner ve gönderim kullanıcının kendi alan adı itibarını kullanır.
 */

export type MailAttachment = {
  filename: string;
  path: string;
};

export type SendApplicationEmailInput = {
  settings: ApplicationSettings;
  to: string;
  subject: string;
  coverLetter: string;
  attachments: MailAttachment[];
  /** Aday adı — gönderen görünen adı olarak kullanılır. */
  applicantName?: string;
};

export type SendApplicationEmailResult = {
  messageId: string;
  accepted: string[];
};

export async function sendApplicationEmail(
  input: SendApplicationEmailInput
): Promise<SendApplicationEmailResult> {
  const { settings, to } = input;

  const transporter = await createTransporter(settings);
  const fromName = settings.senderName || input.applicantName || "Başvuru";
  const fromAddress = settings.senderEmail;

  if (!fromAddress) {
    throw new Error("Gönderen e-posta adresi tanımlı değil.");
  }

  const attachments = await loadAttachments(input.attachments);

  const info: any = await transporter.sendMail({
    from: { name: fromName, address: fromAddress },
    to,
    // Kullanıcı gönderdiği her başvurunun bir kopyasını kendi kutusunda görür.
    cc: settings.ccSelf ? fromAddress : undefined,
    replyTo: fromAddress,
    subject: input.subject,
    text: input.coverLetter,
    html: buildHtmlBody(input.coverLetter),
    attachments
  });

  if (isDryRun()) {
    console.log(
      `[mailer] PROVA: "${input.subject}" → ${to}` +
        `${settings.ccSelf ? ` (CC: ${fromAddress})` : ""}, ${attachments.length} ek, ` +
        `${input.coverLetter.length} karakter ön yazı. Gerçekte gönderilmedi.`
    );
  }

  return {
    messageId: String(info.messageId ?? ""),
    accepted: (info.accepted ?? []).map((item: unknown) =>
      typeof item === "string" ? item : String((item as { address?: string })?.address ?? "")
    )
  };
}

/** SMTP bağlantısını ve kimlik bilgilerini doğrular; e-posta göndermez. */
export async function verifySmtpConnection(settings: ApplicationSettings): Promise<void> {
  if (isDryRun()) {
    throw new Error(
      "Prova modu (SMTP_DRY_RUN=true) açıkken SMTP bağlantısı doğrulanamaz. Gerçek gönderim için önce prova modunu kapatın."
    );
  }

  const transporter = await createTransporter(settings);
  await transporter.verify();
  await markSmtpVerified(settings.userId);
}

/**
 * Prova modu: `.env` içinde SMTP_DRY_RUN=true iken hiçbir e-posta ağa çıkmaz.
 *
 * Mesaj yine eksiksiz üretilir (alıcı, konu, gövde, ekler) ve konsola yazılır;
 * başvuru "gönderildi" olarak işaretlenir. Otomatik başvuruyu gerçek işverenlere
 * açmadan önce tüm akışı güvenle denemek için kullanılır.
 */
export function isDryRun(): boolean {
  return process.env.SMTP_DRY_RUN === "true";
}

async function createTransporter(settings: ApplicationSettings) {
  const nodemailer = (await import("nodemailer")).default;

  if (isDryRun()) {
    console.warn("[mailer] PROVA MODU (SMTP_DRY_RUN=true): e-posta gönderilmeyecek, yalnızca kayda geçilecek.");
    // jsonTransport mesajı serileştirir ama hiçbir bağlantı açmaz.
    return nodemailer.createTransport({ jsonTransport: true });
  }

  if (!settings.smtpHost || !settings.smtpPort || !settings.smtpUser) {
    throw new Error("SMTP ayarları eksik. Başvuru ayarları ekranından sunucu, port ve kullanıcı adını girin.");
  }

  const password = await getSmtpPassword(settings.userId);

  if (!password) {
    throw new Error("SMTP şifresi bulunamadı veya çözülemedi. Başvuru ayarlarından şifreyi tekrar girin.");
  }

  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    // 465 implicit TLS; 587 STARTTLS ile yükseltilir.
    secure: settings.smtpSecure && settings.smtpPort === 465,
    requireTLS: !settings.smtpSecure || settings.smtpPort !== 465,
    auth: { user: settings.smtpUser, pass: password },
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS ?? 15000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS ?? 10000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS ?? 20000)
  });
}

async function loadAttachments(attachments: MailAttachment[]) {
  const loaded = [];

  for (const attachment of attachments) {
    if (!attachment.path) {
      continue;
    }

    try {
      // Dosya içeriği okunup gömülür; gönderim anında dosya silinse bile ek sağlam kalır.
      const content = await readFile(attachment.path);
      loaded.push({ filename: attachment.filename || path.basename(attachment.path), content });
    } catch (error) {
      console.error(`[mailer] Ek okunamadı (${attachment.path}):`, error instanceof Error ? error.message : error);
    }
  }

  if (!loaded.length) {
    throw new Error("Başvuruya eklenecek CV dosyası okunamadı. Gönderim iptal edildi.");
  }

  return loaded;
}

/** Düz metin ön yazıyı basit, güvenli HTML gövdeye çevirir. */
function buildHtmlBody(coverLetter: string): string {
  const paragraphs = coverLetter
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="margin:0 0 12px;">${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");

  return `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2933;">${paragraphs}</div>`;
}
