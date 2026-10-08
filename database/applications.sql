-- ─────────────────────────────────────────────────────────────────────────
-- CVMatch — CV uyarlama ve otomatik başvuru katmanı
--
-- Bu dosya `database/schema.sql` üzerine eklenir. `npm run migrate` her iki
-- dosyayı da sırayla çalıştırır ve tekrar çalıştırmaya karşı güvenlidir.
-- ─────────────────────────────────────────────────────────────────────────

-- Ana (master) CV. Uyarlama yapabilmek için CV metnini saklamak zorunludur;
-- kullanıcı hesabını sildiğinde CASCADE ile birlikte silinir.
CREATE TABLE IF NOT EXISTS user_cvs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(120) NOT NULL DEFAULT 'Ana CV',
  file_name VARCHAR(255) NULL,
  file_type ENUM('pdf', 'docx') NOT NULL DEFAULT 'pdf',
  raw_text MEDIUMTEXT NOT NULL,
  -- extractProfileFromCv çıktısı (beceriler, unvanlar, arama sinyalleri)
  ai_profile JSON NULL,
  -- extractStructuredCv çıktısı (iletişim, deneyim, eğitim, sertifika blokları)
  structured_cv JSON NULL,
  evaluation JSON NULL,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY user_cvs_user_idx (user_id, is_primary),
  CONSTRAINT user_cvs_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Otomatik başvuru ayarları. Kullanıcı açıkça açmadıkça hiçbir e-posta gitmez.
CREATE TABLE IF NOT EXISTS application_settings (
  user_id BIGINT UNSIGNED NOT NULL,
  auto_apply_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Bu skorun altındaki ilanlar otomatik gönderilmez, onay kuyruğuna düşer.
  auto_apply_min_score TINYINT UNSIGNED NOT NULL DEFAULT 80,
  -- Günlük gönderim tavanı: yanlış eşleşmede zarar sınırlayıcı.
  daily_send_limit SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  -- Bu skorun altındaki ilanlar için başvuru paketi bile hazırlanmaz.
  -- 40: AI skorlama kapalıyken yedek skorlar 55'te tavanlandığı için daha
  -- yüksek bir eşik sistemi anahtarsız kurulumda tamamen sessizleştirir.
  min_prepare_score TINYINT UNSIGNED NOT NULL DEFAULT 40,
  sender_name VARCHAR(120) NULL,
  sender_email VARCHAR(190) NULL,
  smtp_host VARCHAR(190) NULL,
  smtp_port SMALLINT UNSIGNED NULL,
  smtp_secure BOOLEAN NOT NULL DEFAULT TRUE,
  smtp_user VARCHAR(190) NULL,
  -- Uygulama seviyesinde AES-256-GCM ile şifrelenir (lib/apply/secret.ts).
  smtp_password_encrypted VARBINARY(512) NULL,
  smtp_verified_at DATETIME NULL,
  cc_self BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT application_settings_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bir kullanıcının bir ilana yaptığı (veya yapacağı) başvuru.
CREATE TABLE IF NOT EXISTS job_applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  listing_id BIGINT UNSIGNED NULL,
  search_id BIGINT UNSIGNED NULL,
  cv_id BIGINT UNSIGNED NULL,

  -- İlan anlık görüntüsü: ilan cache'ten düşse bile başvuru okunabilir kalsın.
  listing_title VARCHAR(255) NOT NULL,
  listing_company VARCHAR(190) NULL,
  listing_location VARCHAR(190) NULL,
  listing_platform VARCHAR(80) NULL,
  listing_url VARCHAR(700) NOT NULL,

  match_score TINYINT UNSIGNED NOT NULL DEFAULT 0,

  status ENUM(
    'preparing',        -- CV uyarlanıyor / dosyalar üretiliyor
    'needs_review',     -- hazır, kullanıcı onayı bekliyor
    'queued',           -- otomatik gönderim için sıraya alındı
    'sent',             -- e-posta gönderildi
    'manual_required',  -- e-posta yok; portaldan elle başvurulmalı
    'skipped',          -- kullanıcı atladı
    'failed'            -- hazırlama veya gönderim hatası
  ) NOT NULL DEFAULT 'preparing',

  channel ENUM('email', 'portal') NOT NULL DEFAULT 'portal',
  recipient_email VARCHAR(190) NULL,
  -- E-postanın ilan metninden mi yoksa elle mi geldiği (denetim için).
  recipient_source VARCHAR(40) NULL,

  -- Uyarlama çıktısı
  tailored_cv JSON NULL,
  cover_letter MEDIUMTEXT NULL,
  email_subject VARCHAR(255) NULL,
  -- İlanın istediği ama CV'de kanıtı olmayan gereksinimler (uydurulmaz, raporlanır).
  gap_report JSON NULL,
  keyword_alignment JSON NULL,
  tailoring_source ENUM('ai', 'heuristic') NOT NULL DEFAULT 'heuristic',

  pdf_path VARCHAR(500) NULL,
  docx_path VARCHAR(500) NULL,

  auto_applied BOOLEAN NOT NULL DEFAULT FALSE,
  approved_at DATETIME NULL,
  sent_at DATETIME NULL,
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  error_message TEXT NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  -- Aynı ilana iki kez başvuru üretilmesini engeller.
  UNIQUE KEY job_applications_user_url_unique (user_id, listing_url(250)),
  KEY job_applications_user_status_idx (user_id, status),
  KEY job_applications_created_idx (created_at),
  KEY job_applications_search_idx (search_id),
  CONSTRAINT job_applications_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT job_applications_listing_fk FOREIGN KEY (listing_id) REFERENCES job_listings(id) ON DELETE SET NULL,
  CONSTRAINT job_applications_cv_fk FOREIGN KEY (cv_id) REFERENCES user_cvs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Denetim izi: "sistem benim adıma ne yaptı" sorusunun cevabı.
CREATE TABLE IF NOT EXISTS application_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  message TEXT NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY application_events_app_idx (application_id, created_at),
  CONSTRAINT application_events_app_fk FOREIGN KEY (application_id) REFERENCES job_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
