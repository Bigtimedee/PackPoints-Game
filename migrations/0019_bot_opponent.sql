-- Prompt 20: AI bot opponent for empty matchmaking queue

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;

-- Seed the bot user record (upsert-safe)
INSERT INTO users (id, username, username_normalized, is_admin, is_bot, status, created_at, updated_at)
VALUES (
  'packpts-bot-00000000-0000-0000-0000-000000000001',
  'PackPTS Bot',
  'packpts bot',
  FALSE,
  TRUE,
  'ACTIVE',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET is_bot = TRUE;
