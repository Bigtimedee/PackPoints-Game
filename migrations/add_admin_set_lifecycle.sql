BEGIN;
-- Transactional, idempotent. No legacy set enrollment, mask edits, approvals or cache purge.
CREATE TABLE IF NOT EXISTS admin_set_lifecycles (
 set_id varchar PRIMARY KEY REFERENCES game_sets(id) ON DELETE CASCADE,
 identity text NOT NULL, profile jsonb, revision text NOT NULL,
 published boolean NOT NULL DEFAULT false, updated_by varchar NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin_set_card_reviews (
 card_id varchar PRIMARY KEY REFERENCES playable_cards(id) ON DELETE CASCADE,
 set_id varchar NOT NULL REFERENCES admin_set_lifecycles(set_id) ON DELETE CASCADE,
 revision text NOT NULL, witness jsonb NOT NULL, witness_key text NOT NULL,
 request_id varchar NOT NULL, status text NOT NULL CHECK(status IN ('pending','processing','ready','approved','error','excluded')),
 source_hash text, preview_hash text, plan_hash text, filename text, reason text,
 approved_by varchar, approved_at timestamptz, lease_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_set_card_reviews_queue ON admin_set_card_reviews(status, lease_until);
CREATE TABLE IF NOT EXISTS admin_set_preparation_jobs (
 request_id varchar PRIMARY KEY, set_id varchar NOT NULL REFERENCES admin_set_lifecycles(set_id) ON DELETE CASCADE,
 revision text NOT NULL, input_hash text NOT NULL, results jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
