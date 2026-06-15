-- Prompt 19: Wire ELO to matchmaking queue with expanding band

ALTER TABLE matchmaking_tickets ADD COLUMN IF NOT EXISTS elo_rating INTEGER DEFAULT 1200;

CREATE INDEX IF NOT EXISTS idx_matchmaking_tickets_elo ON matchmaking_tickets(elo_rating);
