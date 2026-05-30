# CVMatch

CVMatch, Türkiye odaklı bir **CV analiz ve gerçek iş ilanı eşleştirme** uygulamasıdır. Kullanıcı PDF/DOCX CV yükler; sistem aday profilini çıkarır, veritabanındaki **aktif gerçek ilanları** filtreler, en uygunları AI ile puanlar ve doğrudan **ilan detay linkleriyle** listeler.

## Mimari: neden cache-first?

En kritik tasarım kararı: **kullanıcı CV yüklediğinde canlı crawler çalışmaz.**

Canlı bir crawler kullanıcı akışında çalışırsa siteler yavaş açılır, anti-bot korumaları devreye girer ve kullanıcı dakikalarca bekler. Bunun yerine sistem dört rolü ayırır:

| Rol | Ne yapar | Ne zaman çalışır |
| --- | --- | --- |
| **Crawler** | İş sitelerinden ilan toplar, normalize edip `job_listings` cache'ine yazar | Arka planda (`npm run crawl:jobs`) |
| **Verifier** | Cache'teki ilanların hâlâ açık olup olmadığını kontrol eder (active/stale/expired) | Arka planda (`npm run verify:jobs`) |
| **Search** | DB cache'ten hızlı eşleştirme yapar | Kullanıcı CV yükleyince |
| **AI** | Sadece kısa listeyi (en iyi ~15 ilan) CV'ye göre puanlar | Kullanıcı akışında, kısa liste üzerinde |

Akışlar:

```
Arka plan veri hazırlama:
  İş siteleri -> crawler -> normalize -> MySQL job_listings

Kullanıcı akışı (hızlı):
  CV upload -> CV metin çıkarma -> AI CV profili -> DB aktif ilan ön filtre -> AI skorlama -> sonuçlar

Arka plan doğrulama:
  job_listings -> verifier -> active / stale / expired
```

Sonuç: CV yükleyen kullanıcı **dakikalarca beklemez**; sonuçlar DB cache'ten hazırlanır. Crawler hiç çalışmamış olsa bile `npm run seed:jobs` ile yüklenen örnek veriyle demo çalışır.

## Özellikler

- PDF (`pdf-parse`) ve DOCX (`mammoth`) CV metin çıkarma — dosya **diske yazılmaz**, bellekte işlenir.
- Gemini ile zengin CV profili çıkarımı (beceri, pozisyon, kıdem, hedef roller, sorgu varyasyonları).
- Gemini ile detaylı CV değerlendirmesi (puan, güçlü/eksik yönler, öneriler).
- **Gemini erişilemezse otomatik heuristic (kural tabanlı) fallback** — kullanıcı boş ekran görmez.
- Cache-first ilan araması: FULLTEXT + LIKE ile aday havuzu, ucuz ön filtre skoru, sonra AI skorlama.
- AI skorlama başarısız olursa ön filtre skoruyla "unscored" gerçek ilan sonuçları döner.
- Kuyruk tabanlı worker: atomik job claim, heartbeat, timeout, takılan job kurtarma.
- Sadece gerçek ilan detay linkleri gösterilir; sahte/generic arama linki üretilmez.
- Tüm Türkiye veya 81 il içinden çoklu il + çalışma modeli (fark etmez/uzaktan/hibrit/ofisten) filtresi.
- KVKK aydınlatma ve açık rıza kaydı, `bcrypt` ile şifre saklama.
- Tek sayfalık Türkçe arayüz.

## Teknoloji

Next.js 14 · TypeScript · React · Tailwind CSS · MySQL (`mysql2`) · Gemini API · `pdf-parse` · `mammoth` · `cheerio` · Puppeteer (yalnızca crawler fallback) · `tsx`

## Kurulum

```bash
npm install
cp .env.example .env      # değerleri doldurun (Windows: copy .env.example .env)
npm run migrate           # tabloları oluşturur / eksik kolonları ekler (non-destructive)
npm run seed:jobs         # cache'e 35+ örnek gerçek ilan yükler (demo için yeterli)
npm run dev               # http://localhost:3000
```

> `npm run seed:jobs` sayesinde canlı crawler hiç çalışmasa bile uygulama sonuç üretir.

### Opsiyonel arka plan komutları

```bash
npm run crawl:jobs        # gerçek sitelerden ilan toplayıp cache'i doldurur (arka plan)
npm run verify:jobs       # cache'teki ilanların açık/kapalı durumunu günceller (arka plan)
npm run worker            # ayrı bir worker process'i (upload endpoint zaten worker'ı tetikler)
```

## Komutlar

| Komut | Açıklama |
| --- | --- |
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | Production build |
| `npm run start` | Production sunucu |
| `npm run lint` | ESLint |
| `npm run migrate` | Non-destructive DB migration |
| `npm run seed:jobs` | Örnek ilanları cache'e yükler |
| `npm run crawl:jobs` | Arka plan crawler (cache doldurma) |
| `npm run verify:jobs` | Arka plan verifier (ilan kapanma kontrolü) |
| `npm run worker` | Kuyruk worker process'i |

`crawl:jobs` özel sorgularla da çalışır: `npm run crawl:jobs -- "react developer" "ihracat uzmanı"`

## Ortam değişkenleri

Tüm değişkenler `.env.example` içinde açıklanmıştır. Önemli olanlar:

- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`
- `GEMINI_API_KEY`, `GEMINI_MODEL` (varsayılan `gemini-2.5-flash`) — **boş bırakılırsa heuristic fallback devreye girer**
- `GEMINI_TIMEOUT_MS` (20000), `GEMINI_MAX_ATTEMPTS` (2), `GEMINI_MIN_INTERVAL_MS` (500)
- `CRAWLER_*` — yalnızca arka plan crawler'ı etkiler; kullanıcı akışında çalışmaz. `CRAWLER_ENABLE_LINKEDIN=false` (LinkedIn varsayılan kapalı)
- `JOB_HEARTBEAT_MS` (5000), `JOB_SEARCH_TIMEOUT_MS` (90000), `JOB_STALE_PROCESSING_MINUTES` (2)
- `VERIFY_BATCH_SIZE` (50), `VERIFY_FETCH_TIMEOUT_MS` (10000), `VERIFY_EXPIRE_AFTER_DAYS` (30)

> `.env` git'e gönderilmez (`.gitignore`). Gerçek anahtarlarınızı `.env` içinde tutun.

## API

### `POST /api/upload-cv`
FormData: `file`, `locationMode`, `cities` (JSON string), `workMode`, `userEmail`. İşi kuyruğa atar ve worker'ı tetikler.

```json
{ "searchId": 123, "status": "pending", "message": "İşlem kuyruğa alındı." }
```

### `GET /api/search-jobs/[id]`
Job durumunu döner. Frontend 3 saniyede bir bu endpoint'i sorgular. `cv_text` asla dönmez. `pending`/`processing` görürse worker'ı tetikler, takılan `processing` job'ı otomatik `pending`'e çeker.

```json
{ "id": 123, "status": "completed", "progress": 100, "aiProfile": {}, "evaluation": {}, "summary": {}, "results": [] }
```

`results` dizisindeki her öğe gerçek bir ilandır (`kind: "job"`) ve `url` alanı platform ilan detay linkidir.

### `POST /api/search-jobs`
Profil verisiyle doğrudan cache-first arama (geriye uyumluluk). Canlı crawler çağırmaz.

### `POST /api/register`
KVKK/açık rıza ile kullanıcı kaydı. Şifre `bcrypt` ile hashlenir.

### `POST /api/generate-job-links`
Eski endpoint, geriye uyumluluk için durur. Yeni arayüz `/api/upload-cv` kuyruk akışını kullanır.

## Veri tabanı

`npm run migrate` **non-destructive** çalışır: `CREATE TABLE IF NOT EXISTS` kullanır, tabloları/kolonları **drop etmez**, eksik kolonları `ALTER TABLE ADD COLUMN` ile ekler, enum'ları yerinde genişletir. Tablolar:

- `job_sources` — platform kaynakları
- `job_listings` — gerçek ilan cache'i (`status`: active/stale/expired/failed, `last_checked_at`, FULLTEXT index)
- `job_searches` — CV arama kuyruğu (`cv_text` completed/failed sonrası NULL'lanır)
- `users` — KVKK/kayıt
- `job_search_results`, `crawl_runs` — yardımcı tablolar

## Demo akışı

1. `npm run migrate && npm run seed:jobs && npm run dev`
2. Tarayıcıda `http://localhost:3000`
3. KVKK onayını ver, hesabı oluştur.
4. PDF/DOCX bir CV yükle, lokasyon ve çalışma modeli seç, "CV Analizini Başlat".
5. İlerleme çubuğu dolarken ("Sonuçlar hazırlanıyor. İlerleme: %X") sonuçlar DB cache'ten hazırlanır.
6. Tamamlandığında CV analiz kartı + skorlanmış gerçek ilan kartları ("İlanı Aç" linkleriyle) görünür.

## Sorun giderme

- **Gemini 403 / anahtar hatası** → API anahtarı veya model yetkisi sorunlu. Sistem otomatik heuristic fallback'e geçer; sonuçlar yine görünür (`evaluation.source: "heuristic"`). Doğru bir `GEMINI_API_KEY` girip modeli (`GEMINI_MODEL`) hesabınızın erişebildiği bir değere ayarlayın.
- **Sonuçlar boş** → `npm run seed:jobs` çalıştırın. DB'de `status='active'` ilan olduğundan emin olun.
- **DB bağlantı hatası** → `MYSQL_*` değerlerini kontrol edin; MySQL'in çalıştığından ve veritabanı kullanıcısının yetkili olduğundan emin olun. `npm run migrate` veritabanını oluşturur.
- **Crawler boş dönüyor** → Normaldir; platformların anti-bot koruması olabilir. Demo `seed:jobs` ile çalışır, crawler arka plan içindir.
- **`verify:jobs` örnek ilanları "expired" yaptı** → Örnek (sample) ilanların URL'leri gerçek formatlı ama canlı sayfa değildir; verifier bazılarını 404 nedeniyle kapalı işaretleyebilir. Demo cache'ini geri yüklemek için tekrar `npm run seed:jobs` çalıştırın (ilanlar yeniden `active` olur). Verifier asıl olarak `crawl:jobs` ile toplanan gerçek ilanlar içindir.
- **Job "processing"da takıldı** → Status endpoint'i `JOB_STALE_PROCESSING_MINUTES` sonrası job'ı otomatik `pending`'e çekip yeniden işler.
- **AI skorları yerine "Manuel arama / düşük güven" sonuçlar** → Gemini geçici olarak yoğun/erişilemez (ör. 503) olabilir. Sistem bu durumda ön eşleşme puanıyla gerçek ilanları yine gösterir; birkaç dakika sonra tekrar deneyin.

## Gizlilik

- CV dosyası **diske yazılmaz**, sadece bellekte parse edilir.
- CV metni (`cv_text`) yalnızca job işlenene kadar geçici tutulur; completed/failed sonrası **NULL** yapılır.
- API yanıtları `cv_text` döndürmez.
- Şifreler `bcrypt` ile hashlenir; KVKK ve açık rıza tarihleri saklanır.
