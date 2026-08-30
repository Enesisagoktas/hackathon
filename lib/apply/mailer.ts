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

  let info: any;
  try {
    info = await transporter.sendMail({
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
  } catch (error) {
    // Ham SMTP/DNS hataları ("getaddrinfo ENOTFOUND smtp.example.com") son
    // kullanıcıya hiçbir şey anlatmıyor; ne olduğunu ve ne yapması gerektiğini
    // söyleyen bir mesaja çevrilir.
    throw new Error(describeSmtpError(error, settings));
  }

  if (isDryRun()) {
    console.log(
      `[mailer] PROVA: "${input.subject}" → ${to}` +
        `${settings.ccSelf ? ` (CC: ${fromAddress})` : ""}, ${attachments.length} ek, ` +
        `${input.coverLetter.length} karakter ön yazı. Gerçekte gönderilmedi.`
    );
  }

  const accepted = toAddressList(info.accepted);
  const rejected = toAddressList(info.rejected);

  // SMTP bağlantısı başarılı olsa bile sunucu ALICIYI reddetmiş olabilir
  // (kapalı kutu, yanlış adres). Bu durumda sendMail hata fırlatmaz; sonucu
  // okumazsak başvuruyu "Gönderildi" diye işaretler ve kullanıcı hiç
  // ulaşmamış bir başvuruyu yapılmış sanardı.
  if (!isDryRun() && (rejected.length > 0 || accepted.length === 0)) {
    throw new Error(
      `İlandaki başvuru adresi (${rejected[0] ?? to}) e-postayı kabul etmedi. ` +
        "Adres kapalı veya hatalı olabilir; bu ilana ilan sayfasından başvurabilirsin."
    );
  }

  return { messageId: String(info.messageId ?? ""), accepted };
}

export type SendDigestEmailInput = {
  settings: ApplicationSettings;
  /** Alıcı — HER ZAMAN kullanıcının kendi kayıtlı adresi (dışarıya gitmez). */
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * Feature #10 — Yeni eşleşme özeti e-postası.
 *
 * Başvuru e-postasından farkları: ek zorunlu değildir, alıcı işveren değil
 * kullanıcının KENDİSİDİR ve CC uygulanmaz. Taşıma katmanı (kullanıcının kendi
 * SMTP'si), prova modu (SMTP_DRY_RUN) ve hata çevirisi aynen ortaktır.
 */
export async function sendDigestEmail(input: SendDigestEmailInput): Promise<void> {
  const { settings, to } = input;

  const transporter = await createTransporter(settings);
  const fromAddress = settings.senderEmail;

  if (!fromAddress) {
    throw new Error("Gönderen e-posta adresi tanımlı değil.");
  }

  let info: any;
  try {
    info = await transporter.sendMail({
      from: { name: settings.senderName || "CVMatch", address: fromAddress },
      to,
      subject: input.subject,
      text: input.text,
      html: input.html
    });
  } catch (error) {
    throw new Error(describeSmtpError(error, settings));
  }

  if (isDryRun()) {
    console.log(`[mailer] PROVA: özet e-postası "${input.subject}" → ${to}. Gerçekte gönderilmedi.`);
    return;
  }

  const accepted = toAddressList(info.accepted);
  const rejected = toAddressList(info.rejected);

  if (rejected.length > 0 || accepted.length === 0) {
    throw new Error(`Özet e-postası alıcı tarafından kabul edilmedi (${rejected[0] ?? to}).`);
  }
}

/** nodemailer accepted/rejected alanlarını düz adres listesine çevirir. */
function toAddressList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item : String((item as { address?: string })?.address ?? "")))
    .filter(Boolean);
}

/**
 * SMTP/ağ hatalarını kullanıcının anlayacağı, ne yapacağını söyleyen Türkçe
 * mesaja çevirir. Teknik ayrıntı log'da kalır.
 */
export function describeSmtpError(error: unknown, settings: ApplicationSettings): string {
  const raw = error instanceof Error ? error.message : String(error);
  const code = String((error as { code?: string })?.code ?? "");
  const responseCode = Number((error as { responseCode?: number })?.responseCode ?? 0);
  const host = settings.smtpHost ?? "SMTP sunucusu";

  console.error("[mailer] Gönderim hatası:", code || responseCode || "", raw);

  // Sunucu adı çözülemedi / erişilemedi
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || /getaddrinfo/i.test(raw)) {
    return `E-posta sunucusuna ulaşılamadı (${host}). Ayarlardaki sunucu adresi hatalı olabilir; "Ayarlar"dan e-posta adresini tekrar kaydet.`;
  }

  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ESOCKET" || /timeout/i.test(raw)) {
    return `E-posta sunucusuna bağlanılamadı (${host}). İnternet bağlantını kontrol et; kurumsal ağlar SMTP portlarını kapatabiliyor.`;
  }

  // Kimlik doğrulama
  if (code === "EAUTH" || responseCode === 535 || responseCode === 534 || /invalid login|authentication|username and password/i.test(raw)) {
    const isGmail = /gmail|googlemail/i.test(settings.smtpHost ?? "") || /gmail|googlemail/i.test(settings.senderEmail ?? "");
    return isGmail
      ? "E-posta şifresi kabul edilmedi. Gmail normal şifreni kabul etmez: Google hesabında 2 adımlı doğrulamayı açıp 16 haneli 'Uygulama Şifresi' üret ve Ayarlar'dan onu gir."
      : "E-posta kullanıcı adı veya şifresi kabul edilmedi. Çoğu sağlayıcı normal şifre yerine 'uygulama şifresi' ister; Ayarlar'dan tekrar dene.";
  }

  // Alıcı reddi
  if (responseCode === 550 || responseCode === 553 || /recipient|mailbox/i.test(raw)) {
    return "İlandaki başvuru adresi e-postayı kabul etmedi (adres kapalı veya hatalı olabilir). Bu ilana ilan sayfasından başvurabilirsin.";
  }

  // Günlük kota
  if (responseCode === 421 || responseCode === 452 || /quota|rate limit|too many/i.test(raw)) {
    return "E-posta sağlayıcın günlük gönderim sınırına ulaştı. Yarın tekrar dene veya günlük gönderim tavanını düşür.";
  }

  return `E-posta gönderilemedi: ${raw.slice(0, 160)}`;
}

/** SMTP bağlantısını ve kimlik bilgilerini doğrular; e-posta göndermez. */
export async function verifySmtpConnection(settings: ApplicationSettings): Promise<void> {
  if (isDryRun()) {
    throw new Error(
      "Prova modu (SMTP_DRY_RUN=true) açıkken SMTP bağlantısı doğrulanamaz. Gerçek gönderim için önce prova modunu kapatın."
    );
  }

  const transporter = await createTransporter(settings);

  try {
    await transporter.verify();
  } catch (error) {
    throw new Error(describeSmtpError(error, settings));
  }

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
