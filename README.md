# CVMatch

CVMatch, PDF veya DOCX formatında CV yükleyip CV içeriğinden beceri, pozisyon ve dil bilgisi çıkaran; ardından lokasyon ve çalışma modeli tercihlerine göre Türkiye iş platformları için skorlanmış iş arama rotaları hazırlayan bir Next.js uygulamasıdır.

## Özellikler

- PDF CV metin çıkarma: `pdf-parse`
- DOCX CV metin çıkarma: `mammoth`
- Regex + manuel liste tabanlı keyword extraction
- Kariyer.net, Secretcv, Eleman.net, Yenibiriş, Toptalent ve Webrazzi Jobs üzerinde gerçek ilan detay URL keşfi
- İlan detay sayfası parse etme: pozisyon, şirket, lokasyon, açıklama, kriter metni
- CV ile gerçek ilan metni arasında eşleşme skoru ve gerekçe üretimi
- Tüm Türkiye veya 81 il içinden çoklu il seçimi
- Uzaktan, hibrit, ofisten veya fark etmez çalışma modeli filtresi
- MySQL tabanlı kullanıcı kaydı
- KVKK aydınlatma ve açık rıza kabul kaydı
- AI destekli CV puanı, detaylı İK analizi ve geliştirme önerileri
- Tek sayfalık Türkçe arayüz
- Dosya boyutu limiti: 5 MB
- Sadece PDF/DOCX kabulü
- CV dosyaları kalıcı olarak saklanmaz

## Teknoloji

- Next.js 14
- TypeScript
- Tailwind CSS
- shadcn/ui uyumlu bileşen yapısı
- lucide-react
- pdf-parse
- mammoth
- mysql2
- bcryptjs
- cheerio

## Kurulum

```bash
npm install
mysql -u root -p < database/schema.sql
npm run dev
```

`.env.example` dosyasını `.env.local` olarak kopyalayıp MySQL bilgilerinizi girin.

Uygulama varsayılan olarak `http://localhost:3000` adresinde çalışır.

## Komutlar

```bash
npm run dev
npm run lint
npm run build
npm run start
```

## API

### `POST /api/upload-cv`

FormData ile `file` alanı bekler.

Yanıt örneği:

```json
{
  "skills": ["React", "Next.js", "TypeScript"],
  "titles": ["Frontend Developer"],
  "languages": ["English"],
  "experienceAreas": ["Frontend geliştirme"],
  "evaluation": {
    "source": "ai",
    "score": 74,
    "category": "İyi aday",
    "professionCategory": "Teknik / Yazılım"
  },
  "textPreview": "..."
}
```

AI değerlendirmesi için `OPENAI_API_KEY` girilirse CV puanı modelden alınır. Anahtar yoksa sistem aynı formatta kural tabanlı fallback analiz üretir.

### `POST /api/register`

İstek örneği:

```json
{
  "fullName": "Ada Lovelace",
  "email": "ada@example.com",
  "password": "minimum8",
  "kvkkAccepted": true,
  "explicitConsentAccepted": true
}
```

Kullanıcı şifresi `bcrypt` ile hashlenir. KVKK ve açık rıza kabul tarihleri MySQL'de saklanır. CV dosyası saklanmaz.

### `POST /api/search-jobs`

İstek örneği:

```json
{
  "skills": ["React", "Next.js"],
  "titles": ["Frontend Developer"],
  "searchKeywords": ["React", "Next.js", "TypeScript"],
  "industries": ["Technology"],
  "locationMode": "cities",
  "cities": ["Ankara", "İzmir", "İstanbul"],
  "workMode": "remote"
}
```

Yanıt örneği:

```json
{
  "summary": {
    "targetRole": "Frontend Developer",
    "primarySkills": ["React", "Next.js"],
    "locations": ["İstanbul"],
    "workMode": "Uzaktan",
    "resultCount": 8
  },
  "results": [
    {
      "kind": "job",
      "platform": "Kariyer.net",
      "category": "recommended",
      "title": "Frontend Developer",
      "company": "Örnek Teknoloji A.Ş.",
      "location": "İstanbul",
      "query": "Frontend Developer React Next.js",
      "url": "https://www.kariyer.net/is-ilani/ornek-teknoloji-frontend-developer-1234567",
      "matchScore": 98,
      "matchReasons": ["React, Next.js ilan metninde geçti."]
    }
  ],
  "fallbackResults": []
}
```

Ana sonuç listesi gerçek ilan detay linklerinden oluşur. Platform crawler sonuç çıkaramazsa `fallbackResults` içinde manuel arama linkleri ayrıca dönebilir; bunlar ana ilan listesine eklenmez.
Eski `POST /api/generate-job-links` endpoint'i geriye uyumluluk için durur, ancak yeni arayüz `/api/search-jobs` kullanır.

Desteklenen filtre değerleri:

- `locationMode`: `all-turkey` veya `cities`
- `cities`: `locationMode` değeri `cities` ise 81 Türkiye ilinden seçilen liste
- `workMode`: `any`, `remote`, `hybrid`, `onsite`

## İş Platformu Stratejisi

Uygulama Google benzeri genel web araması üretmez. CV içeriğinden çıkan beceri, pozisyon, lokasyon ve çalışma modeli ile Türkiye'deki popüler iş platformlarında ilan detay linkleri keşfeder, detay sayfalarını parse eder ve CV uyumuna göre sıralar.

Platform grupları:

- Genel platformlar: Kariyer.net, Secretcv, Eleman.net, Yenibiriş
- Kamusal kaynak: İŞKUR
- Teknoloji ve nitelikli aday platformları: Toptalent, Webrazzi Jobs

## Kapsam Notları

- CV saklama yok
- CV dosyaları kalıcı olarak saklanmaz
- Platformlar crawler tarafından parse edilemiyorsa ana sonuç listesinde arama sayfası gösterilmez; yedek bağlantılar ayrı bölümde tutulur
- Gerçek ilan cache'i için MySQL tabloları hazırdır
- Harici arama API entegrasyonu yoktur
- Dinamik/stateful platformlar statik crawler ile parse edilemezse durum kullanıcıya crawler özeti olarak gösterilir

## Deploy

Vercel üzerinde standart Next.js deploy akışıyla çalışır.
