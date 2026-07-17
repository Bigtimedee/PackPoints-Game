-- Prompt 6: Co-creation collaboration sessions
ALTER TABLE game_sets
  ADD COLUMN IF NOT EXISTS co_creator_user_id VARCHAR REFERENCES users(id);

CREATE TABLE IF NOT EXISTS collaboration_sessions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id VARCHAR NOT NULL REFERENCES users(id),
  guest_user_id VARCHAR REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'waiting',
  nominated_cards JSONB NOT NULL DEFAULT '[]',
  approved_cards JSONB NOT NULL DEFAULT '[]',
  set_name TEXT,
  maker_note TEXT,
  published_set_id VARCHAR REFERENCES game_sets(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collab_sessions_host ON collaboration_sessions(host_user_id);
CREATE INDEX IF NOT EXISTS idx_collab_sessions_status ON collaboration_sessions(status);
