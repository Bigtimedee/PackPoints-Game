-- Collector Intelligence: dimensional rollup marts (Prompt 2)
CREATE TABLE IF NOT EXISTS card_attention_daily (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  player_key TEXT NOT NULL,
  day DATE NOT NULL,
  is_clean BOOLEAN NOT NULL,
  plays INTEGER NOT NULL DEFAULT 0,
  unique_users INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  incorrect INTEGER NOT NULL DEFAULT 0,
  sum_latency_ms INTEGER NOT NULL DEFAULT 0,
  cnt_latency INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_card_attention_daily ON card_attention_daily(player_key, day, is_clean);
CREATE INDEX IF NOT EXISTS idx_card_attention_daily_day ON card_attention_daily(day);

CREATE TABLE IF NOT EXISTS set_engagement_daily (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  game_set_id VARCHAR NOT NULL,
  day DATE NOT NULL,
  is_clean BOOLEAN NOT NULL,
  starts INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0,
  unique_users INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_set_engagement_daily ON set_engagement_daily(game_set_id, day, is_clean);
CREATE INDEX IF NOT EXISTS idx_set_engagement_daily_day ON set_engagement_daily(day);

CREATE TABLE IF NOT EXISTS commerce_funnel_daily (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  game_set_id VARCHAR NOT NULL,
  day DATE NOT NULL,
  is_clean BOOLEAN NOT NULL,
  listing_clicks INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_funnel_daily ON commerce_funnel_daily(game_set_id, day, is_clean);
CREATE INDEX IF NOT EXISTS idx_commerce_funnel_daily_day ON commerce_funnel_daily(day);
