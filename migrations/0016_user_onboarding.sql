-- Prompt 17: First-session onboarding tutorial

CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id VARCHAR PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  points_awarded BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_user_onboarding_completed ON user_onboarding(completed_at);
