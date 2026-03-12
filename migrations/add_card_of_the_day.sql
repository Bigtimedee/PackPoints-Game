-- Card of the Day feature
CREATE TABLE IF NOT EXISTS card_of_the_day (
  id SERIAL PRIMARY KEY,
  card_id INTEGER NOT NULL,
  date DATE NOT NULL UNIQUE,
  difficulty_score NUMERIC(5,2),
  wrong_answer_rate NUMERIC(5,2),
  times_shown INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_of_the_day_date ON card_of_the_day(date);
