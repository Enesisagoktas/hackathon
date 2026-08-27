# CVMatch

CV'nizi yükleyin. Sistem size uygun ilanları bulur, **her ilan için CV'nizi o ilana göre yeniden yazar**, ön yazısını hazırlar ve — izin verdiğiniz eşiğin üstündeki eşleşmelerde — **başvuruyu sizin adınıza gönderir**.

## Akış

```
CV yükle
   ↓
AI profil çıkarımı + CV puanlama
   ↓
Veritabanı cache'indeki aktif ilanlarla eşleştirme ve skorlama
   ↓
Her uygun ilan için:  CV'yi o ilana göre yeniden kurgula  →  PDF + DOCX üret  →  ön yazı yaz
   ↓
İlanda başvuru e-postası var mı?
   ├─ var  →  skor eşiği geçildiyse OTOMATİK GÖNDER, yoksa onay kuyruğuna al
   └─ yok  →  paketi hazırla, ilan sayfasından tek tıkla tamamlaman için beklet
```

## Uydurma yasağı

Bu sistemin en önemli kuralı: **uyarlanan CV'ye sizde olmayan hiçbir beceri eklenmez.**

İlan "Kubernetes zorunlu" diyor ama CV'nizde Kubernetes yoksa, sistem onu CV'ye yazmaz. Bunun yerine ayrı bir **eksikler raporunda** size gösterir. Uydurulmuş bir beceri mülakatta ortaya çıkar ve başvuruyu bitirir.

Teknik olarak bu şöyle uygulanır (`lib/cv/tailor.ts`):

1. Ana CV'den bir **kanıt indeksi** çıkarılır (beceri listesi + tüm CV metni).
2. AI'nin önerdiği her beceri bu indekse karşı doğrulanır (`enforceEvidence`).
3. Kanıtı olmayan terim atılır ve `gaps` raporuna düşer.
4. Anahtar kelime hizalama tablosunda kanıt kontrolü AI'yi **ezer**: kanıt yoksa "karşılanıyor" denemez.

Uyarlama şunları yapar: ilanın istediği ve sizde **olan** becerileri en üste taşır, ilanın terminolojisini kullanır (ATS uyumu), deneyimlerinizi ilana yakınlığa göre yeniden sıralar, ilanda geçmeyen ama işvereni ilgilendirebilecek gerçek becerilerinizi ayrıca öne çıkarır.

## Kurulum

```bash
npm install
```

`.env.example` dosyasını `.env` olarak kopyalayın ve doldurun:

```bash
cp .env.example .env
```

**Zorunlu:** `APP_SECRET` (en az 32 karakter). Oturum çerezini imzalar ve SMTP şifrenizi AES-256-GCM ile şifreler. Üretmek için:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Veritabanını kurun ve örnek ilanları yükleyin:

```bash
npm run migrate
```

```bash
npm run seed:jobs
```

Uygulamayı başlatın:

```bash
npm run dev
```

## Gemini anahtarı

`GEMINI_API_KEY` **olmadan da sistem uçtan uca çalışır**, ancak düşürülmüş modda:

| | Anahtar var | Anahtar yok |
|---|---|---|
| CV profil çıkarımı | AI | Kural tabanlı |
| İlan eşleştirme skoru | 0–100 semantik | Anahtar kelime, **55'te tavanlı** |
| CV uyarlama | AI ile yeniden yazım | Sıralama + öne çıkarma |
| Otomatik gönderim | Eşik üstünde çalışır | **Hiç çalışmaz** — hepsi onaya düşer |

Son satır kasıtlıdır: yalnızca anahtar kelime örtüşmesine dayanan bir eşleşmeye güvenip işverene e-posta göndermek sizin itibarınıza zarar verir. Bu koruma `lib/apply/pipeline.ts` içinde `isConfidentMatch` ile uygulanır.

Anahtar yoksa arayüzde bunu açıklayan bir uyarı görünür.

## Otomatik başvuru

Arayüzdeki **Otomatik Başvuru Ayarları** panelinden yapılandırılır. Varsayılan olarak **kapalıdır**; siz açmadıkça hiçbir e-posta gitmez.

| Ayar | Varsayılan | Ne yapar |
|---|---|---|
| Otomatik gönderim eşiği | 80 | Bu puanın altındakiler onay bekler |
| Günlük gönderim tavanı | 10 | Yanlış eşleşmede zararı sınırlar |
| Paket hazırlama eşiği | 40 | Bu puanın altına CV bile uyarlanmaz |
| Kendime CC at | açık | Gönderilen her başvurunun kopyası size gelir |

Başvurular **sizin kendi SMTP hesabınızdan** çıkar, sistemin ortak bir adresinden değil. Böylece işverenin "Yanıtla" tuşu doğrudan size döner. Gmail ve Yandex için normal şifre değil **uygulama şifresi** gerekir.

SMTP şifreniz veritabanına AES-256-GCM ile şifrelenmiş olarak yazılır ve hiçbir API yanıtında geri dönmez.

### Prova modu

Gerçek işverenlere e-posta gitmeden tüm akışı denemek için:

```bash
SMTP_DRY_RUN=true
```

Bu modda mesaj eksiksiz üretilir (alıcı, konu, gövde, ekler), konsola yazılır ve başvuru "gönderildi" işaretlenir — ama **hiçbir bağlantı açılmaz**. Otomatik başvuruyu açmadan önce bunu kullanın.

## Başvuru durumları

| Durum | Anlamı |
|---|---|
| `preparing` | CV uyarlanıyor, dosyalar üretiliyor |
| `needs_review` | Paket hazır, sizin onayınızı bekliyor |
| `queued` | Otomatik gönderim için sıraya alındı |
| `sent` | E-posta gönderildi |
| `manual_required` | İlanda e-posta yok; ilan sayfasından başvurmalısınız |
| `skipped` | Atladınız |
| `failed` | Hazırlama veya gönderim hatası |

Her başvurunun altında **"Sistem bu başvuruda ne yaptı"** bölümü vardır: paketin ne zaman hazırlandığı, alıcı adresinin nereden bulunduğu, neden gönderildiği veya gönderilmediği tek tek yazılır.

## Veri ve KVKK

CV metniniz, her ilana göre yeniden yazılabilmesi için **hesabınıza bağlı olarak saklanır**. (Sistemin önceki sürümü CV'yi analizden sonra siliyordu; uyarlama bunu imkânsız kılıyordu.) Yüklediğiniz dosyanın kendisi diske yazılmaz, yalnızca metni işlenir.

Saklanan CV verisini silmek için:

```bash
curl -X DELETE http://localhost:3000/api/cv --cookie "cvmatch_session=..."
```

Hesabınızı sildiğinizde CV'niz, ayarlarınız ve başvurularınız `ON DELETE CASCADE` ile birlikte silinir.

## Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | Üretim derlemesi (dev sunucusu kapalıyken çalıştırın) |
| `npm run migrate` | Şema kurulumu/güncelleme (tekrar çalıştırmaya güvenli) |
| `npm run seed:jobs` | Örnek ilanları cache'e yükler |
| `npm run crawl:jobs` | Gerçek ilanları tarar ve cache'i doldurur |
| `npm run verify:jobs` | Cache'teki ilanların hâlâ açık olduğunu kontrol eder |
| `npm run worker` | Kuyruk işleyicisini ayrı süreçte çalıştırır |
| `npm run make:cv` | Test için örnek CV PDF'leri üretir |
| `npm run test:apply` | Başvuru hattı testi (DB'ye karşı, e-posta göndermez) |
| `npm run test:e2e` | Uçtan uca HTTP testi (`npm run dev` açıkken) |

`npm run worker` isteğe bağlıdır: API isteği geldiğinde işleyici zaten süreç içinde başlar (`ensureJobWorkerRunning`). Ayrı süreç, uzun taramaları web sunucusundan ayırmak istediğinizde işe yarar.

## Testler

```bash
npm run test:apply
```

57 kontrol: kanal tespiti, CV bölümleme, **uydurma engeli**, uçtan uca paket üretimi, gerçek PDF/DOCX çıktısı, tekrar başvuru koruması, gönderim korumaları, eşik davranışı ve düşük güvenli eşleşmelerin engellenmesi. Prova modu kullanır; hiçbir e-posta göndermez.

```bash
npm run test:e2e
```

35 kontrol: yetkilendirme, hesap ele geçirme koruması, CV yükleme, worker akışı, başvuru paketleri, dosya indirme, **kullanıcılar arası veri izolasyonu** ve KVKK silme. Çalışan bir `npm run dev` gerektirir.

## API

### Kimlik

| Uç | Açıklama |
|---|---|
| `POST /api/register` | Kayıt + oturum. E-posta kayıtlıysa aynı şifreyle giriş dener, tutmazsa 409/401 döner. |
| `POST /api/auth/login` | Giriş |
| `POST /api/auth/logout` | Çıkış |
| `GET /api/auth/me` | Oturumdaki kullanıcı ve kayıtlı CV bilgisi |

### CV ve arama

| Uç | Açıklama |
|---|---|
| `POST /api/upload-cv` | CV yükler, ana CV olarak saklar, aramayı kuyruğa alır. Oturum zorunlu. |
| `GET /api/search-jobs/[id]` | Arama durumu, sonuçlar ve başvuru özeti. Yalnızca sahibi okuyabilir. |
| `GET /api/cv` · `DELETE /api/cv` | Saklanan CV'yi okur / siler |

### Başvurular

| Uç | Açıklama |
|---|---|
| `GET /api/applications` | Başvuru listesi ve durum sayaçları |
| `GET /api/applications/[id]` | Uyarlanmış CV, ön yazı, eksik raporu, denetim izi, HTML önizleme |
| `POST /api/applications/[id]/send` | Onaylayıp gönderir |
| `POST /api/applications/[id]/skip` | Atlar |
| `POST /api/applications/[id]/manual` | Portal başvurusunu "elle yaptım" olarak işaretler |
| `GET /api/applications/[id]/file?format=pdf\|docx` | Uyarlanmış CV dosyasını indirir |

### Ayarlar

| Uç | Açıklama |
|---|---|
| `GET /api/settings/apply` · `PUT /api/settings/apply` | Otomatik başvuru ve SMTP ayarları |
| `POST /api/settings/apply/verify` | SMTP bağlantısını test eder (e-posta göndermez) |

## Mimari

```
app/api/…                 HTTP uçları (hepsi oturum kontrollü)
lib/auth/                 İmzalı çerez oturumu + kullanıcı işlemleri
lib/cv/
  structured.ts           Ham CV metnini bölümlere ayırır (AI + kural tabanlı yedek)
  skill-dictionary.ts     Beceri sözlüğü + yapışık metin çözümleme
  tailor.ts               İlana göre CV yeniden kurgulama + uydurma engeli
  render-html.ts          ATS uyumlu HTML şablon
  render-files.ts         PDF (puppeteer) + DOCX (docx) üretimi
  store.ts                Ana CV deposu
lib/apply/
  channel.ts              İlanda başvuru e-postası var mı?
  pipeline.ts             Uyarla → üret → kanal seç → gönder/onaya bırak
  mailer.ts               SMTP gönderimi + prova modu
  settings.ts             Kullanıcı başına otomatik başvuru ayarları
  secret.ts               SMTP şifresi şifreleme (AES-256-GCM)
  repository.ts           Başvuru kayıtları ve denetim izi
lib/jobs/                 İlan cache'i, crawler, skorlama
lib/job-worker.ts         Kuyruk işleyicisi
```

### Türkçe metin işleme notu

Kod içinde birkaç yerde `\b` ve `/i` yerine ASCII normalleştirme kullanılır. Sebebi: JavaScript'te `/^iş/i.test("İŞ DENEYİMİ")` **false** döner. `İ` (U+0130) ile `i` regex'in `/i` bayrağıyla eşleşmez ve `\b` sınırı `\w = [A-Za-z0-9_]` ile tanımlı olduğu için Türkçe harflerde oluşmaz. Bu, büyük harfli Türkçe CV'lerin tamamının sessizce ayrıştırılamamasına yol açar. `lib/cv/structured.ts` içindeki bölüm başlığı eşleştirmesi ve şehir tespiti bu yüzden normalize edilmiş metin üzerinden çalışır.

### ATS uyumu notu

Üretilen CV'de her görsel boşluğun altında **gerçek bir ayırıcı karakter** vardır. Beceriler flex "pill" düzeniyle değil `·` ayırıcılı satır içi metinle yazılır; iş/eğitim kayıtlarında tarih, başlıkla aynı satırda flex `space-between` ile değil alt satırda şirket/konumla birlikte yer alır. Sebebi: flex boşluğu PDF metnine boşluk karakteri koymaz ve ilan sistemleri `"TypeScriptReact"`, `"Bilgisayar Mühendisliği2016 - 2020"` gibi birleşik metin okur.

Aynı sorun *gelen* CV'lerde de vardır; `lib/cv/skill-dictionary.ts` yapışık beceri bloklarını sözlükle çözer.

## Teknoloji

Next.js 14 · TypeScript · Tailwind CSS · MySQL 8 · Gemini · Puppeteer (PDF) · docx (DOCX) · Nodemailer (SMTP) · Cheerio (crawler)

## Sınırlar

- **Kariyer.net / LinkedIn gibi portallara otomatik giriş yapılmaz.** Sistem sizin portal şifrelerinizi istemez ve saklamaz. Bu ilanlar için başvuru paketi hazırlanır, gönderimi ilan sayfasından siz tamamlarsınız.
- Otomatik gönderim yalnızca **ilan metninde başvuru e-postası bulunan** ilanlarda mümkündür. Platform adresleri (`info@kariyer.net`), `noreply@…` ve başvuru bağlamı olmayan adresler kasıtlı olarak elenir.
- İlan cache'i `npm run crawl:jobs` ile doldurulur; kullanıcı akışında canlı tarama yapılmaz.
