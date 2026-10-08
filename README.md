# CVMatch

CV'ni yükle, sana uygun iş ilanlarını bulsun. CVMatch, PDF veya DOCX formatındaki CV'den beceri ve pozisyon bilgisini çıkarır, Türkiye'deki iş sitelerinden toplanan ilanlarla karşılaştırır ve her ilan için 0–100 arası bir uyum puanı verir. İstenirse CV'yi seçilen ilana göre düzenleyip başvuru paketini de hazırlar.

> BTK Hackathon 2026 için 2 kişilik ekip olarak geliştirdik. Hackathon sonrasında geliştirmeye devam ettim.

## Özellikler

- PDF ve DOCX CV okuma
- CV'den beceri, pozisyon ve deneyim çıkarma (Gemini API; anahtar yoksa kural tabanlı çalışır)
- Kariyer.net, Secretcv, Eleman.net, Yenibiriş ve Toptalent ilanlarını tarama ve önbelleğe alma
- İlan–CV uyum puanı ve gerekçesi; il ve çalışma modeli (uzaktan / hibrit / ofis) filtresi
- İlana göre CV uyarlama, PDF ve DOCX çıktı (CV'de olmayan beceri eklenmez)
- Kullanıcının kendi e-posta hesabıyla başvuru gönderimi (varsayılan olarak kapalı)
- Hesap, oturum, KVKK onayı ve veri silme

## Teknolojiler

Next.js 14 · TypeScript · Tailwind CSS · MySQL 8 · Gemini API · Cheerio · Puppeteer · Nodemailer

## Kurulum

Gereksinimler: Node.js 18+ ve MySQL 8

```bash
npm install
cp .env.example .env    # MySQL bilgilerini ve APP_SECRET değerini gir
npm run migrate         # veritabanı şeması
npm run seed:jobs       # örnek ilanlar
npm run dev             # http://localhost:3000
```

## Testler

```bash
npm run test:units      # birim testleri
npm run test:apply      # başvuru akışı (e-posta göndermez)
npm run test:e2e        # uçtan uca testler (npm run dev açıkken)
```

## Proje yapısı

```
app/          sayfalar ve API uçları
components/   arayüz bileşenleri
lib/cv/       CV ayrıştırma, uyarlama, PDF/DOCX üretimi
lib/jobs/     ilan tarama, önbellek ve puanlama
lib/apply/    başvuru akışı ve e-posta gönderimi
scripts/      tarama, bakım ve test betikleri
database/     SQL şemaları
```
