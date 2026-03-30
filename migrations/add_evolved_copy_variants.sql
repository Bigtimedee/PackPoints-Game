-- Migration: add evolved_copy_variants table
-- Stores AI-generated social copy produced by the nightly prompt evolution loop.

CREATE TABLE IF NOT EXISTS evolved_copy_variants (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type social_content_type NOT NULL,
  platform    VARCHAR(20) NOT NULL,
  ab_group    VARCHAR(1) NOT NULL,
  copy_text   TEXT NOT NULL,
  generation  INTEGER NOT NULL DEFAULT 1,
  rationale   TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evolved_copy_active
  ON evolved_copy_variants (is_active, content_type, platform);
