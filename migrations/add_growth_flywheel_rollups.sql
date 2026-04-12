-- Growth Flywheel Rollup Tables
-- Aggregated daily metrics derived from gameplay_events, share_events,
-- referral_attributions, and daily_challenge_entries.

CREATE TABLE IF NOT EXISTS global_growth_rollups (
  id                       VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  day_key                  VARCHAR(10) NOT NULL UNIQUE,
  dau                      INTEGER NOT NULL DEFAULT 0,
  matches_played           INTEGER NOT NULL DEFAULT 0,
  daily5_entries           INTEGER NOT NULL DEFAULT 0,
  shares_total             INTEGER NOT NULL DEFAULT 0,
  invites_sent             INTEGER NOT NULL DEFAULT 0,
  signups_from_invites     INTEGER NOT NULL DEFAULT 0,
  first_matches_from_invites   INTEGER NOT NULL DEFAULT 0,
  first_purchases_from_invites INTEGER NOT NULL DEFAULT 0,
  k_factor                 REAL,
  computed_at              TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_global_growth_rollups_day ON global_growth_rollups (day_key);

CREATE TABLE IF NOT EXISTS user_growth_rollups (
  id                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               VARCHAR NOT NULL REFERENCES users(id),
  day_key               VARCHAR(10) NOT NULL,
  matches_played        INTEGER NOT NULL DEFAULT 0,
  daily5_entries        INTEGER NOT NULL DEFAULT 0,
  shares_total          INTEGER NOT NULL DEFAULT 0,
  invites_sent          INTEGER NOT NULL DEFAULT 0,
  signups_from_invites  INTEGER NOT NULL DEFAULT 0,
  computed_at           TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_user_growth_rollup UNIQUE (user_id, day_key)
);

CREATE INDEX IF NOT EXISTS idx_user_growth_rollup_day  ON user_growth_rollups (day_key);
CREATE INDEX IF NOT EXISTS idx_user_growth_rollup_user ON user_growth_rollups (user_id);
