CREATE DATABASE IF NOT EXISTS cvmatch
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE cvmatch;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  kvkk_accepted_at DATETIME NOT NULL,
  explicit_consent_accepted_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(80) NOT NULL,
  base_url VARCHAR(255) NOT NULL,
  category ENUM('general', 'tech', 'public') NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY job_sources_name_unique (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_listings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id BIGINT UNSIGNED NOT NULL,
  external_id VARCHAR(190) NULL,
  title VARCHAR(255) NOT NULL,
  company VARCHAR(190) NULL,
  location VARCHAR(190) NULL,
  work_mode ENUM('any', 'remote', 'hybrid', 'onsite') NULL,
  description TEXT NULL,
  requirements JSON NULL,
  candidate_criteria JSON NULL,
  salary_text VARCHAR(190) NULL,
  posted_at DATETIME NULL,
  expires_at DATETIME NULL,
  source_query VARCHAR(255) NULL,
  external_url VARCHAR(700) NOT NULL,
  content_hash VARCHAR(64) NULL,
  matched_keywords JSON NULL,
  raw_json JSON NULL,
  parse_status ENUM('parsed', 'summary_only', 'failed') NOT NULL DEFAULT 'parsed',
  parse_version VARCHAR(40) NULL,
  error_count INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('active', 'stale', 'expired') NOT NULL DEFAULT 'active',
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY job_listings_source_url_unique (source_id, external_url(255)),
  KEY job_listings_title_idx (title),
  KEY job_listings_location_idx (location),
  KEY job_listings_work_mode_idx (work_mode),
  KEY job_listings_status_seen_idx (status, last_seen_at),
  FULLTEXT KEY job_listings_fulltext_idx (title, company, description),
  CONSTRAINT job_listings_source_fk FOREIGN KEY (source_id) REFERENCES job_sources(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crawl_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_id BIGINT UNSIGNED NOT NULL,
  query_text VARCHAR(255) NOT NULL,
  status ENUM('success', 'partial', 'empty', 'failed', 'timeout') NOT NULL,
  searched_url_count INT UNSIGNED NOT NULL DEFAULT 0,
  discovered_url_count INT UNSIGNED NOT NULL DEFAULT 0,
  parsed_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY crawl_runs_source_query_idx (source_id, query_text),
  KEY crawl_runs_started_at_idx (started_at),
  CONSTRAINT crawl_runs_source_fk FOREIGN KEY (source_id) REFERENCES job_sources(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_searches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_email VARCHAR(190) NULL,
  
  status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  cv_text MEDIUMTEXT NULL,

  target_role VARCHAR(190) NULL,
  skills JSON NULL,
  titles JSON NULL,
  cities JSON NULL,
  work_mode ENUM('any', 'remote', 'hybrid', 'onsite') NOT NULL DEFAULT 'any',

  ai_profile JSON NULL,
  evaluation JSON NULL,
  summary JSON NULL,
  results JSON NULL,

  result_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message TEXT NULL,

  started_at DATETIME NULL,
  ready_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY job_searches_user_email_idx (user_email),
  KEY job_searches_created_at_idx (created_at),
  KEY job_searches_status_idx (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_search_results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  search_id BIGINT UNSIGNED NOT NULL,
  listing_id BIGINT UNSIGNED NULL,
  platform VARCHAR(80) NOT NULL,
  result_kind ENUM('job', 'search') NOT NULL DEFAULT 'search',
  title VARCHAR(255) NOT NULL,
  query_text VARCHAR(255) NOT NULL,
  result_url VARCHAR(700) NOT NULL,
  match_score TINYINT UNSIGNED NOT NULL,
  match_reasons JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY job_search_results_search_idx (search_id),
  KEY job_search_results_score_idx (match_score),
  CONSTRAINT job_search_results_search_fk FOREIGN KEY (search_id) REFERENCES job_searches(id),
  CONSTRAINT job_search_results_listing_fk FOREIGN KEY (listing_id) REFERENCES job_listings(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO job_sources (name, base_url, category) VALUES
  ('Kariyer.net', 'https://www.kariyer.net', 'general'),
  ('Secretcv', 'https://www.secretcv.com', 'general'),
  ('Eleman.net', 'https://www.eleman.net', 'general'),
  ('Yenibiriş', 'https://www.yenibiris.com', 'general'),
  ('Toptalent', 'https://toptalent.co', 'tech'),
  ('Webrazzi Jobs', 'https://jobs.webrazzi.com', 'tech'),
  ('İŞKUR', 'https://esube.iskur.gov.tr', 'public')
ON DUPLICATE KEY UPDATE
  base_url = VALUES(base_url),
  category = VALUES(category),
  is_active = TRUE,
  updated_at = NOW();
