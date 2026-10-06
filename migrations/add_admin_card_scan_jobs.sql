-- Apply with the normal production migration process BEFORE deploying scan routes.
-- No code-side CREATE TABLE, no new credentials, no modification of existing card data.
-- Durable reports and cross-worker exclusion. Interrupted jobs deliberately keep the
-- running-set lock: reconcile actual card writes before an operator marks one failed.
CREATE TABLE IF NOT EXISTS admin_card_scan_jobs (
  id uuid PRIMARY KEY,
  set_id varchar NOT NULL,
  kind text NOT NULL CHECK (kind IN ('silhouettes', 'mismatches')),
  request_id uuid NOT NULL UNIQUE,
  auto_quarantine boolean NOT NULL DEFAULT false,
  actor_id varchar NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  report jsonb NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_card_scan_one_running_set
  ON admin_card_scan_jobs (set_id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS admin_card_scan_set_created
  ON admin_card_scan_jobs (set_id, created_at DESC NULLS LAST);

-- Admin reports contain card metadata. Mirror the repository's deny-by-default PostgREST protection.
-- Express DATABASE_URL role must own/bypass RLS (as for existing admin tables).
ALTER TABLE admin_card_scan_jobs ENABLE ROW LEVEL SECURITY;

-- Fail closed unless the service connection bypasses this deny-by-default policy.
-- A newly created table is owned by the creating app role; FORCE RLS is not enabled.
DO $$
DECLARE access_ok boolean;
BEGIN
  SELECT r.rolsuper OR r.rolbypassrls OR c.relowner = r.oid
    INTO access_ok
    FROM pg_roles r JOIN pg_class c ON c.oid = 'admin_card_scan_jobs'::regclass
    WHERE r.rolname = current_user;
  IF access_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Admin scan migration requires app-role RLS bypass or table ownership';
  END IF;
END $$;
