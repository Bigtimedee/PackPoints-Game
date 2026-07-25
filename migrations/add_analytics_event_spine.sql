-- Collector Intelligence: analytics event spine + price history (Prompt 1)
CREATE TABLE IF NOT EXISTS analytics_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW(),
  user_hash VARCHAR(64),
  session_id TEXT,
  is_clean BOOLEAN NOT NULL DEFAULT TRUE,
  player_key TEXT,
  game_set_id VARCHAR,
  set_name TEXT,
  sport TEXT,
  brand TEXT,
  year INTEGER,
  card_id TEXT,
  is_user_created_set BOOLEAN,
  outcome TEXT,
  latency_ms INTEGER,
  payload JSONB
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type_time ON analytics_events(event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_player_time ON analytics_events(player_key, occurred_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_set_time ON analytics_events(game_set_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_time ON analytics_events(occurred_at);

CREATE TABLE IF NOT EXISTS card_price_history (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_on DATE NOT NULL,
  player_key TEXT NOT NULL,
  cardhedge_card_id TEXT,
  game_set_id VARCHAR,
  year INTEGER,
  raw_price_cents INTEGER,
  source TEXT NOT NULL DEFAULT 'cardhedge',
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_card_price_history_day ON card_price_history(captured_on, player_key, year);
CREATE INDEX IF NOT EXISTS idx_card_price_history_player ON card_price_history(player_key, captured_on);
