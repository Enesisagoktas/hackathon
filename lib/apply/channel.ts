import type { TailoringListing } from "@/lib/cv/types";

/**
 * Bir ilana nasıl başvurulacağını belirler.
 *
 * - `email`: ilan metninde gerçek bir başvuru adresi var → sistem gönderebilir.
 * - `portal`: adres yok → paket hazırlanır, kullanıcı ilan sayfasından gönderir.
 *
 * Platformun kendi kurumsal adresleri (info@kariyer.net, noreply@... vb.)
 * başvuru adresi DEĞİLDİR; bunlara gönderim yapılırsa hem işe yaramaz hem de
 * spam sayılır. Bu yüzden agresif biçimde filtrelenirler.
 */

export type ApplicationChannel = "email" | "portal";

export type ChannelDecision = {
  channel: ApplicationChannel;
  recipientEmail?: string;
  /** Adresin nereden geldiği — denetim kaydına yazılır. */
  recipientSource?: "listing_description" | "listing_requirements" | "manual";
  reason: string;
};

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** İlan platformlarının kendi alan adları — başvuru adresi olamazlar. */
const PLATFORM_DOMAINS = [
  "kariyer.net", "secretcv.com", "eleman.net", "yenibiris.com", "toptalent.co",
  "webrazzi.com", "linkedin.com", "iskur.gov.tr", "indeed.com", "glassdoor.com",
  "monster.com", "jobs.com", "kariyer.com"
];

/** Başvuru kutusu olmayan teknik/otomatik adres önekleri. */
const BLOCKED_LOCAL_PARTS = [
  "noreply", "no-reply", "donotreply", "do-not-reply", "postmaster", "mailer-daemon",
  "abuse", "webmaster", "hostmaster", "privacy", "kvkk", "unsubscribe", "bounce",
  "notification", "notifications", "bildirim", "destek", "support", "help",
  "sales", "satis", "pazarlama", "marketing", "reklam", "fatura", "muhasebe", "billing"
];

/** Bunlar gerçek başvuru kutusu olma ihtimali yüksek adreslerdir. */
const PREFERRED_LOCAL_PARTS = [
  "ik", "hr", "kariyer", "career", "careers", "basvuru", "basvurular", "cv",
  "insankaynaklari", "insan.kaynaklari", "humanresources", "recruitment", "isealim", "jobs"
];

/** Adresin başvuru bağlamında geçtiğini gösteren ifadeler. */
const APPLY_CONTEXT_PATTERN =
  /(cv|özgeçmiş|ozgecmis|başvuru|basvuru|resume|apply|application|gönder|gonder|ilet|iletiniz|adresine)/i;

export function decideApplicationChannel(listing: TailoringListing): ChannelDecision {
  const fromRequirements = findApplicationEmail(
    [...listing.requirements, ...listing.candidateCriteria].join("\n")
  );

  if (fromRequirements) {
    return {
      channel: "email",
      recipientEmail: fromRequirements,
      recipientSource: "listing_requirements",
      reason: `İlanın nitelik bölümünde başvuru adresi bulundu: ${fromRequirements}`
    };
  }

  const fromDescription = findApplicationEmail(listing.description);

  if (fromDescription) {
    return {
      channel: "email",
      recipientEmail: fromDescription,
      recipientSource: "listing_description",
      reason: `İlan açıklamasında başvuru adresi bulundu: ${fromDescription}`
    };
  }

  return {
    channel: "portal",
    reason:
      "İlan metninde başvuru e-postası yok. Başvuru paketi hazırlandı; ilan sayfasından tek tıkla tamamlayabilirsiniz."
  };
}

/**
 * Metindeki adaylar arasından en olası başvuru adresini seçer.
 * Hiçbiri güvenilir değilse `undefined` döner — tahminle e-posta gönderilmez.
 */
export function findApplicationEmail(text: string): string | undefined {
  if (!text) {
    return undefined;
  }

  const matches = text.match(EMAIL_PATTERN) ?? [];
  const scored: Array<{ email: string; score: number }> = [];

  for (const raw of matches) {
    const email = raw.toLowerCase().replace(/[.,;:)]+$/, "");
    const [localPart, domain] = email.split("@");

    if (!localPart || !domain) continue;
    if (PLATFORM_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`))) continue;
    if (BLOCKED_LOCAL_PARTS.some((blocked) => localPart === blocked || localPart.startsWith(`${blocked}.`))) continue;

    let score = 0;

    if (PREFERRED_LOCAL_PARTS.some((preferred) => localPart === preferred || localPart.startsWith(preferred))) {
      score += 50;
    }

    // Adresin çevresindeki 120 karakterde başvuru bağlamı geçiyor mu?
    const index = text.toLowerCase().indexOf(email);
    if (index >= 0) {
      const context = text.slice(Math.max(0, index - 120), index + email.length + 60);
      if (APPLY_CONTEXT_PATTERN.test(context)) {
        score += 30;
      }
    }

    // Kişisel adresler (ad.soyad@) kurumsal kutulardan daha az tercih edilir.
    if (/^[a-z]+\.[a-z]+$/.test(localPart)) {
      score += 5;
    }

    scored.push({ email, score });
  }

  if (!scored.length) {
    return undefined;
  }

  scored.sort((left, right) => right.score - left.score);

  // Hiçbir sinyal yoksa (skor 0) tahmin yürütmek yerine portal akışına düş.
  return scored[0].score > 0 ? scored[0].email : undefined;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
