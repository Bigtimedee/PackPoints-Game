-- Persistent 1v1 Battle Sessions
--
-- A Battle Session groups multiple sequential matches between the same two
-- registered users. Once two users start a 1v1 Battle (via friend match
-- invite), the session persists across multiple matches until one of the
-- users disconnects from the game. The opponent is then notified and the
-- session is ended.

CREATE TABLE IF NOT EXISTS battle_sessions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id varchar NOT NULL,
  host_user_id varchar NOT NULL,
  guest_user_id varchar NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  end_reason text,
  ended_by_user_id varchar,
  current_match_id varchar,
  match_count integer NOT NULL DEFAULT 0,
  host_wins integer NOT NULL DEFAULT 0,
  guest_wins integer NOT NULL DEFAULT 0,
  ties integer NOT NULL DEFAULT 0,
  created_at timestamp DEFAULT now(),
  ended_at timestamp
);

CREATE INDEX IF NOT EXISTS idx_battle_sessions_status ON battle_sessions(status);
CREATE INDEX IF NOT EXISTS idx_battle_sessions_host ON battle_sessions(host_user_id);
CREATE INDEX IF NOT EXISTS idx_battle_sessions_guest ON battle_sessions(guest_user_id);
CREATE INDEX IF NOT EXISTS idx_battle_sessions_lobby ON battle_sessions(lobby_id);

ALTER TABLE matches ADD COLUMN IF NOT EXISTS session_id varchar;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS sequence_number integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_matches_session ON matches(session_id);
