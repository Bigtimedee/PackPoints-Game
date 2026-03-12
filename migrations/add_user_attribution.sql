-- User acquisition attribution (UTM tracking)
CREATE TABLE IF NOT EXISTS user_attribution (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  utm_source VARCHAR(255),
  utm_medium VARCHAR(255),
  utm_campaign VARCHAR(255),
  utm_term VARCHAR(255),
  utm_content VARCHAR(255),
  referrer VARCHAR(500),
  landing_page VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_attribution_user_id ON user_attribution(user_id);
CREATE INDEX IF NOT EXISTS idx_user_attribution_source ON user_attribution(utm_source);
CREATE INDEX IF NOT EXISTS idx_user_attribution_campaign ON user_attribution(utm_campaign);
