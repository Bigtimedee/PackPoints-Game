-- Growth Agent mandate: Listen -> Create -> Distribute -> Learn
-- Idempotent tables for ranked growth signals and creative performance snapshots.

CREATE TABLE IF NOT EXISTS growth_signals (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_key VARCHAR(160) NOT NULL UNIQUE,
  source VARCHAR(20) NOT NULL,
  signal_type VARCHAR(40) NOT NULL,
  title TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  payload JSONB DEFAULT '{}'::jsonb,
  asset_path TEXT,
  observed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_growth_signals_score ON growth_signals (score);
CREATE INDEX IF NOT EXISTS idx_growth_signals_type ON growth_signals (signal_type);
CREATE INDEX IF NOT EXISTS idx_growth_signals_observed ON growth_signals (observed_at);

CREATE TABLE IF NOT EXISTS growth_creative_metrics (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id VARCHAR(100) NOT NULL UNIQUE,
  platform VARCHAR(20),
  content_type VARCHAR(40),
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  signups INTEGER NOT NULL DEFAULT 0,
  game_starts INTEGER NOT NULL DEFAULT 0,
  activations INTEGER NOT NULL DEFAULT 0,
  d1_retained INTEGER NOT NULL DEFAULT 0,
  d7_retained INTEGER NOT NULL DEFAULT 0,
  qdau_per_thousand REAL NOT NULL DEFAULT 0,
  computed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_growth_creative_metrics_qdau ON growth_creative_metrics (qdau_per_thousand);
CREATE INDEX IF NOT EXISTS idx_growth_creative_metrics_platform ON growth_creative_metrics (platform);
CREATE INDEX IF NOT EXISTS idx_growth_creative_metrics_computed ON growth_creative_metrics (computed_at);
