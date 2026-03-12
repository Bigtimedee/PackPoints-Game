-- Newsletter opt-in and unsubscribe token fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS newsletter_opted_in BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS newsletter_unsubscribe_token VARCHAR(64);

-- Generate tokens for existing users
UPDATE users
SET newsletter_unsubscribe_token = encode(gen_random_bytes(32), 'hex')
WHERE newsletter_unsubscribe_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_newsletter_unsubscribe_token ON users(newsletter_unsubscribe_token) WHERE newsletter_unsubscribe_token IS NOT NULL;
