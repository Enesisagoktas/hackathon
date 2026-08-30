import { normalizeComparable } from "@/lib/jobs/normalize";

/**
 * Meslek/unvan normalizasyon sözlüğü (Feature #1).
 *
 * MEVCUT SİSTEMİN YERİNİ ALMAZ: source-registry'deki professionTags kaynak
 * seçiminde kalır; bu katman ARAMA ÜRETİMİNİ ve ALAKA EŞLEŞMESİNİ besler.
 * "Backend Developer" arayan bir CV'nin "Yazılım Mühendisi (Backend)" veya
 * "Sunucu Tarafı Geliştirici" başlıklı ilanları kaçırmaması için.
 *
 * ÜÇ AYRI YAKINLIK SINIFI (bilinçli olarak birbirine karışmaz):
 *   equivalent → aynı iş, farklı ad. Arama sorgularına ve başlık
 *                eşleşmesine girer.
 *   related    → komşu meslek (ör. Backend ↔ Full Stack). YALNIZCA
 *                anahtar kelime katmanına girer; sorgu üretmez —
 *                alakasız sonuç patlamasını önler.
 *   adjacent   → "keşfet" önerileri için; eşleştirmeye HİÇ girmez.
 *
 * Sözlük kontrollüdür: buraya girmeyen meslekler için davranış bugünkü
 * gibi kalır (sıfır regresyon ilkesi).
 */

export type ProfessionEntry = {
  canonical: string;
  /** Aynı işin adları — TR + EN. Hepsi normalizeComparable ile karşılaştırılır. */
  equivalent: string[];
  /** Komşu meslekler (yalnız keyword katmanı). */
  related: string[];
  /** Keşif önerileri (eşleştirme dışı). */
  adjacent: string[];
};

export const PROFESSION_DICTIONARY: ProfessionEntry[] = [
  // ── Yazılım ──
  {
    canonical: "backend_developer",
    equivalent: [
      "backend developer", "back end developer", "backend engineer",
      "backend yazılım", "arka uç geliştirici", "sunucu tarafı geliştirici",
      "software engineer backend", "yazılım geliştirici backend", "server side developer"
    ],
    related: ["full stack developer", "yazılım geliştirici", "software engineer", "api developer"],
    adjacent: ["devops engineer", "data engineer"]
  },
  {
    canonical: "frontend_developer",
    equivalent: [
      "frontend developer", "front end developer", "frontend engineer",
      "önyüz geliştirici", "ön yüz geliştirici", "arayüz geliştirici",
      "arayüz yazılım uzmanı", "web arayüz geliştirici", "ui developer"
    ],
    related: ["full stack developer", "web geliştirici", "web developer", "yazılım geliştirici"],
    adjacent: ["ui ux designer", "mobil geliştirici"]
  },
  {
    canonical: "software_developer",
    equivalent: [
      "yazılım geliştirici", "yazılım uzmanı", "yazılım mühendisi",
      "software developer", "software engineer", "yazılım geliştirme uzmanı", "developer"
    ],
    related: ["backend developer", "frontend developer", "full stack developer"],
    adjacent: ["test mühendisi", "iş analisti"]
  },
  {
    canonical: "full_stack_developer",
    equivalent: ["full stack developer", "fullstack developer", "full stack geliştirici", "full stack engineer"],
    related: ["backend developer", "frontend developer", "yazılım geliştirici"],
    adjacent: ["devops engineer"]
  },
  {
    canonical: "mobile_developer",
    equivalent: [
      "mobil geliştirici", "mobile developer", "mobil uygulama geliştirici",
      "android developer", "ios developer", "flutter developer", "react native developer"
    ],
    related: ["yazılım geliştirici", "frontend developer"],
    adjacent: []
  },
  {
    canonical: "data_scientist",
    equivalent: ["data scientist", "veri bilimci", "veri bilimi uzmanı"],
    related: ["data analyst", "veri analisti", "machine learning engineer"],
    adjacent: ["data engineer"]
  },

  // ── Sağlık ──
  {
    canonical: "hemsire",
    equivalent: ["hemşire", "nurse", "sağlık memuru hemşire"],
    related: ["servis hemşiresi", "yoğun bakım hemşiresi", "ameliyathane hemşiresi", "iş yeri hemşiresi", "sorumlu hemşire", "klinik hemşiresi"],
    adjacent: ["ebe", "sağlık teknikeri", "paramedik", "anestezi teknikeri"]
  },
  {
    canonical: "ebe",
    equivalent: ["ebe", "midwife"],
    related: ["hemşire", "doğumhane ebesi"],
    adjacent: ["sağlık teknikeri"]
  },
  {
    canonical: "eczaci_kalfasi",
    equivalent: ["eczane teknisyeni", "eczacı kalfası", "eczane çalışanı", "eczane personeli"],
    related: ["eczacı teknikeri"],
    adjacent: ["tıbbi sekreter"]
  },
  {
    canonical: "fizyoterapist",
    equivalent: ["fizyoterapist", "fizik tedavi uzmanı", "physiotherapist"],
    related: ["fizyoterapi teknikeri"],
    adjacent: ["spor eğitmeni"]
  },

  // ── Hizmet / yiyecek-içecek ──
  {
    canonical: "garson",
    equivalent: ["garson", "servis elemanı", "servis personeli", "waiter", "waitress", "servis görevlisi"],
    related: ["komi", "garson yardımcısı", "kafe elemanı", "bar elemanı"],
    adjacent: ["barista", "kasiyer", "host hostes"]
  },
  {
    canonical: "komi",
    equivalent: ["komi", "garson yardımcısı", "mutfak komisi", "busboy"],
    related: ["garson", "bulaşıkçı", "mutfak elemanı"],
    adjacent: []
  },
  {
    canonical: "asci",
    equivalent: ["aşçı", "cook", "chef", "mutfak şefi", "aşçıbaşı"],
    related: ["aşçı yardımcısı", "mutfak elemanı", "pastacı", "kebapçı ustası"],
    adjacent: ["komi"]
  },
  {
    canonical: "barista",
    equivalent: ["barista", "kahve baristası", "kahve hazırlama elemanı"],
    related: ["kafe elemanı", "garson"],
    adjacent: ["kasiyer"]
  },

  // ── Satış / mağaza ──
  {
    canonical: "satis_danismani",
    equivalent: [
      "satış danışmanı", "satış temsilcisi", "mağaza satış danışmanı",
      "satış elemanı", "sales consultant", "sales representative", "mağaza danışmanı"
    ],
    related: ["mağaza elemanı", "reyon görevlisi", "tezgahtar", "kurumsal satış temsilcisi", "saha satış temsilcisi"],
    adjacent: ["kasiyer", "müşteri temsilcisi", "mağaza müdürü"]
  },
  {
    canonical: "kasiyer",
    equivalent: ["kasiyer", "kasa görevlisi", "kasa elemanı", "cashier"],
    related: ["mağaza elemanı", "reyon görevlisi", "market görevlisi", "tezgahtar"],
    adjacent: ["satış danışmanı"]
  },
  {
    canonical: "magaza_elemani",
    equivalent: ["mağaza elemanı", "mağaza görevlisi", "market elemanı", "market görevlisi", "market personeli"],
    related: ["reyon görevlisi", "kasiyer", "depo görevlisi", "tezgahtar"],
    adjacent: ["satış danışmanı"]
  },

  // ── Müşteri hizmetleri / çağrı merkezi ──
  {
    canonical: "musteri_temsilcisi",
    equivalent: [
      "müşteri temsilcisi", "çağrı merkezi müşteri temsilcisi", "çağrı merkezi elemanı",
      "müşteri hizmetleri temsilcisi", "call center", "customer representative", "müşteri danışmanı"
    ],
    related: ["müşteri ilişkileri uzmanı", "çağrı merkezi takım lideri", "santral görevlisi"],
    adjacent: ["satış temsilcisi", "sekreter"]
  },

  // ── Muhasebe / finans ──
  {
    canonical: "muhasebeci",
    equivalent: [
      "muhasebeci", "muhasebe elemanı", "muhasebe uzmanı", "muhasebe personeli",
      "accountant", "genel muhasebe uzmanı", "genel muhasebe elemanı", "muhasebe sorumlusu"
    ],
    related: ["ön muhasebe elemanı", "mali müşavir yardımcısı", "finans uzmanı", "bordro uzmanı", "muhasebe müdürü"],
    adjacent: ["finansal raporlama uzmanı", "denetçi", "mali işler uzmanı"]
  },
  {
    canonical: "on_muhasebe",
    equivalent: ["ön muhasebe elemanı", "ön muhasebe personeli", "ön muhasebe uzmanı", "ön muhasebeci"],
    related: ["muhasebe elemanı", "ofis elemanı", "idari işler elemanı"],
    adjacent: ["sekreter"]
  },

  // ── Eğitim ──
  {
    canonical: "ogretmen",
    equivalent: ["öğretmen", "teacher", "eğitmen", "ders öğretmeni"],
    related: [
      "sınıf öğretmeni", "matematik öğretmeni", "ingilizce öğretmeni",
      "okul öncesi öğretmeni", "rehber öğretmen", "branş öğretmeni", "özel ders öğretmeni"
    ],
    adjacent: ["eğitim koordinatörü", "etüt öğretmeni", "kurs eğitmeni"]
  },
  {
    canonical: "okul_oncesi",
    equivalent: ["okul öncesi öğretmeni", "anaokulu öğretmeni", "kreş öğretmeni", "çocuk gelişimi öğretmeni"],
    related: ["çocuk bakıcısı", "çocuk gelişimi uzmanı", "öğretmen"],
    adjacent: []
  },

  // ── Lojistik / saha ──
  {
    canonical: "sofor",
    equivalent: ["şoför", "sürücü", "driver", "araç sürücüsü"],
    related: ["kamyon şoförü", "tır şoförü", "servis şoförü", "kurye", "dağıtım elemanı", "forklift operatörü"],
    adjacent: ["depo görevlisi"]
  },
  {
    canonical: "kurye",
    equivalent: ["kurye", "moto kurye", "motorlu kurye", "courier", "dağıtım görevlisi", "yaya kurye"],
    related: ["şoför", "dağıtım elemanı", "paket servis elemanı"],
    adjacent: ["depo görevlisi"]
  },
  {
    canonical: "depo_gorevlisi",
    equivalent: ["depo görevlisi", "depo elemanı", "depo personeli", "warehouse", "depo işçisi", "sevkiyat elemanı"],
    related: ["forklift operatörü", "sevkiyat sorumlusu", "lojistik elemanı", "paketleme elemanı"],
    adjacent: ["üretim işçisi"]
  },

  // ── Üretim / teknik ──
  {
    canonical: "uretim_iscisi",
    equivalent: ["üretim işçisi", "üretim elemanı", "üretim personeli", "fabrika işçisi", "üretim operatörü", "vasıfsız işçi", "beden işçisi"],
    related: ["paketleme elemanı", "makine operatörü", "montaj elemanı", "bant işçisi"],
    adjacent: ["depo görevlisi", "kalite kontrol elemanı"]
  },
  {
    canonical: "elektrikci",
    equivalent: ["elektrikçi", "elektrik teknisyeni", "elektrik ustası", "electrician", "elektrik tesisatçısı"],
    related: ["elektrik teknikeri", "elektrik elektronik teknisyeni", "bakım teknisyeni"],
    adjacent: ["elektrik mühendisi", "otomasyon teknisyeni"]
  },
  {
    canonical: "makine_muhendisi",
    equivalent: ["makine mühendisi", "mechanical engineer", "makina mühendisi"],
    related: ["üretim mühendisi", "bakım mühendisi", "proje mühendisi", "ar-ge mühendisi"],
    adjacent: ["endüstri mühendisi", "mekatronik mühendisi"]
  },

  // ── Güvenlik / temizlik ──
  {
    canonical: "guvenlik",
    equivalent: ["güvenlik görevlisi", "özel güvenlik", "güvenlik elemanı", "security", "özel güvenlik görevlisi", "site güvenliği"],
    related: ["bekçi", "danışma görevlisi", "güvenlik amiri"],
    adjacent: []
  },
  {
    canonical: "temizlik",
    equivalent: ["temizlik görevlisi", "temizlik elemanı", "temizlik personeli", "housekeeping", "kat görevlisi", "temizlikçi"],
    related: ["kat hizmetleri elemanı", "ofis temizlik elemanı", "hijyen personeli"],
    adjacent: ["bulaşıkçı"]
  },

  // ── Ofis / idari ──
  {
    canonical: "sekreter",
    equivalent: ["sekreter", "yönetici asistanı", "ofis asistanı", "secretary", "idari asistan", "büro elemanı", "ofis elemanı"],
    related: ["santral görevlisi", "resepsiyon görevlisi", "idari işler elemanı", "veri giriş elemanı"],
    adjacent: ["insan kaynakları asistanı", "ön muhasebe elemanı"]
  },
  {
    canonical: "insan_kaynaklari",
    equivalent: [
      "insan kaynakları uzmanı", "ik uzmanı", "hr specialist", "insan kaynakları sorumlusu",
      "insan kaynakları elemanı", "human resources"
    ],
    related: ["bordro uzmanı", "işe alım uzmanı", "insan kaynakları asistanı", "eğitim uzmanı"],
    adjacent: ["idari işler uzmanı"]
  },
  {
    canonical: "grafik_tasarimci",
    equivalent: ["grafik tasarımcı", "graphic designer", "grafiker", "grafik tasarım uzmanı"],
    related: ["ui ux designer", "sosyal medya tasarımcısı", "web tasarımcı"],
    adjacent: ["sosyal medya uzmanı", "video editörü"]
  },
  {
    canonical: "resepsiyon",
    equivalent: ["resepsiyon görevlisi", "resepsiyonist", "ön büro elemanı", "receptionist", "danışma görevlisi", "ön büro görevlisi"],
    related: ["misafir ilişkileri görevlisi", "sekreter", "santral görevlisi"],
    adjacent: ["otel müdürü yardımcısı"]
  }
];

// ─── Arama yapıları (modül yüklenirken bir kez kurulur) ───────────────────

type IndexedEntry = { entry: ProfessionEntry; matchType: "equivalent" | "related" };

const lookupIndex = new Map<string, IndexedEntry>();

// İKİ GEÇİŞLİ KAYIT: önce TÜM girişlerin equivalent'ları, sonra related'lar.
// Tek geçişte "muhasebeci"nin related listesindeki "ön muhasebe elemanı",
// on_muhasebe girişinin KENDİ equivalent'ından önce anahtarı kapıyordu ve
// "Ön Muhasebe Elemanı" araması yanlış mesleğe düşüyordu (test yakaladı).
// Bir unvanın sahibi her zaman onu equivalent ilan eden giriştir.
for (const entry of PROFESSION_DICTIONARY) {
  for (const alias of entry.equivalent) {
    const key = normalizeComparable(alias);
    if (key && !lookupIndex.has(key)) {
      lookupIndex.set(key, { entry, matchType: "equivalent" });
    }
  }
}

for (const entry of PROFESSION_DICTIONARY) {
  for (const alias of entry.related) {
    const key = normalizeComparable(alias);
    if (key && !lookupIndex.has(key)) {
      lookupIndex.set(key, { entry, matchType: "related" });
    }
  }
}

/**
 * Bir unvan metnini sözlükte arar.
 *
 * Önce tam eşleşme, sonra "unvan sözlük adını içeriyor" gevşek eşleşme
 * denenir ("Kıdemli Backend Developer" → backend_developer). Gevşek
 * eşleşmede EN UZUN alias kazanır ki "developer" tek başına "backend
 * developer"ı gölgelemesin.
 */
export function lookupProfession(title: string): ProfessionEntry | null {
  const normalized = normalizeComparable(title);

  if (!normalized) {
    return null;
  }

  const exact = lookupIndex.get(normalized);
  if (exact) {
    return exact.entry;
  }

  let best: { entry: ProfessionEntry; aliasLength: number } | null = null;

  for (const [alias, indexed] of Array.from(lookupIndex.entries())) {
    if (indexed.matchType !== "equivalent") {
      continue;
    }
    if (alias.length >= 5 && normalized.includes(alias)) {
      if (!best || alias.length > best.aliasLength) {
        best = { entry: indexed.entry, aliasLength: alias.length };
      }
    }
  }

  return best?.entry ?? null;
}

export type ProfessionExpansion = {
  /** Sorgu üretimine ve başlık eşleşmesine girebilecek eşdeğer adlar. */
  equivalents: string[];
  /** Yalnızca anahtar kelime katmanına girecek komşu meslekler. */
  related: string[];
  /** Keşif önerileri (eşleştirme dışı). */
  adjacent: string[];
  /** Hangi kanonik girişler eşleşti (log/teşhis için). */
  canonicals: string[];
};

/**
 * CV'den gelen unvan listesini sözlükle genişletir (Feature #1'in çekirdeği).
 *
 * SINIF AYRIMI KORUNUR: equivalents sorgulara girer, related girmez —
 * "alakasız sonuçları dramatik artırma" yasağının güvencesi budur.
 * Sözlükte karşılığı olmayan unvanlar aynen korunur; girdi asla kaybolmaz.
 */
export function expandProfessionTerms(titles: string[]): ProfessionExpansion {
  const equivalents = new Set<string>();
  const related = new Set<string>();
  const adjacent = new Set<string>();
  const canonicals = new Set<string>();
  const inputKeys = new Set(titles.map((title) => normalizeComparable(title)));

  for (const title of titles) {
    const entry = lookupProfession(title);

    if (!entry) {
      continue;
    }

    canonicals.add(entry.canonical);

    for (const alias of entry.equivalent) {
      if (!inputKeys.has(normalizeComparable(alias))) {
        equivalents.add(alias);
      }
    }
    for (const alias of entry.related) {
      related.add(alias);
    }
    for (const alias of entry.adjacent) {
      adjacent.add(alias);
    }
  }

  return {
    equivalents: Array.from(equivalents),
    related: Array.from(related),
    adjacent: Array.from(adjacent),
    canonicals: Array.from(canonicals)
  };
}
