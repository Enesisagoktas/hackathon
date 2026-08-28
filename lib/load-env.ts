import path from "path";
import dotenv from "dotenv";

/**
 * .env dosyasını, DİĞER modüller yüklenmeden önce okur.
 *
 * NEDEN AYRI BİR MODÜL: `import` deyimleri hoist edilir ve dosyanın gövdesindeki
 * `dotenv.config()` çağrısından ÖNCE çalışır. Ayarlarını modül seviyesinde
 * okuyan bir modül (ör. crawler'ın tarama bütçesi) bu yüzden .env henüz
 * yüklenmemişken varsayılan değerlere düşüyordu — sessizce.
 *
 * Ölçüm: `CRAWLER_MAX_DETAILS_PER_PLATFORM=20` ayarlı olmasına rağmen her
 * platform tam olarak 4 ilan döndürüyordu; yani varsayılan değer kullanılmıştı.
 *
 * KULLANIM: betiklerin İLK import'u bu olmalı:
 *   import "../lib/load-env";
 *   import { ... } from "...";
 *
 * Next.js .env'i kendisi yüklediği için uygulama tarafında gerekmez.
 */
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export {};
