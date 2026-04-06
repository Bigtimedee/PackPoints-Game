-- Seasonal promotions system
CREATE TABLE IF NOT EXISTS promotions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  points_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by VARCHAR REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotions_active_dates ON promotions(active, start_at, end_at);

-- Seed example promotions (starting from 2025)
INSERT INTO promotions (name, description, start_at, end_at, points_multiplier) VALUES
  ('Spring Training Special', 'Double points to celebrate the start of baseball season!', '2025-03-01 00:00:00+00', '2025-03-15 23:59:59+00', 2.0),
  ('NBA Finals Bonus', '1.5x points during the NBA Finals!', '2025-06-01 00:00:00+00', '2025-06-30 23:59:59+00', 1.5),
  ('NFL Draft Weekend', 'Triple points during the NFL Draft!', '2025-04-24 00:00:00+00', '2025-04-27 23:59:59+00', 3.0),
  ('National Card Show', '2x points to celebrate the National Sports Collectors Convention!', '2025-07-23 00:00:00+00', '2025-07-27 23:59:59+00', 2.0),
  ('Holiday Double Points', 'Happy Holidays! Double points all week!', '2025-12-22 00:00:00+00', '2025-12-31 23:59:59+00', 2.0)
ON CONFLICT DO NOTHING;
