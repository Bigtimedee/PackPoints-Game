-- Making Layer: user-uploaded card photos stored in Postgres (Supabase),
-- served via GET /api/card-photos/:id. Replaces the unconfigured R2 path.
CREATE TABLE IF NOT EXISTS card_photos (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  data BYTEA NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/jpeg',
  uploaded_by_user_id VARCHAR REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE card_photos ENABLE ROW LEVEL SECURITY;
