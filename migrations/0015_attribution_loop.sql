-- Prompt 15: Attribution loop — card_views and attributed_purchases tables

CREATE TABLE IF NOT EXISTS card_views (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR REFERENCES users(id),
  card_id VARCHAR,
  card_set_id VARCHAR,
  session_id TEXT,
  ip_hash VARCHAR(64),
  user_agent TEXT,
  page_path TEXT,
  view_duration_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_views_user ON card_views(user_id);
CREATE INDEX IF NOT EXISTS idx_card_views_card ON card_views(card_id);
CREATE INDEX IF NOT EXISTS idx_card_views_created ON card_views(created_at);

CREATE TABLE IF NOT EXISTS attributed_purchases (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_id TEXT NOT NULL,
  outbound_click_id VARCHAR REFERENCES outbound_clicks(id),
  user_id VARCHAR REFERENCES users(id),
  transaction_id TEXT NOT NULL,
  item_id TEXT,
  sale_price_cents INTEGER,
  commission_cents INTEGER,
  conversion_date TIMESTAMP,
  raw_payload JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attributed_purchases_custom_id ON attributed_purchases(custom_id);
CREATE INDEX IF NOT EXISTS idx_attributed_purchases_user ON attributed_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_attributed_purchases_created ON attributed_purchases(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attributed_purchases_transaction ON attributed_purchases(transaction_id);
