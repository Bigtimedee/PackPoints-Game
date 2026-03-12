-- User feedback and feature requests
CREATE TABLE IF NOT EXISTS user_feedback (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category VARCHAR(100) NOT NULL CHECK (category IN ('bug', 'feature_request', 'card_set_request', 'general')),
  message TEXT NOT NULL,
  page_url VARCHAR(500),
  status VARCHAR(50) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'planned', 'done', 'declined')),
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_category ON user_feedback(category);
CREATE INDEX IF NOT EXISTS idx_user_feedback_status ON user_feedback(status);
CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id ON user_feedback(user_id);
