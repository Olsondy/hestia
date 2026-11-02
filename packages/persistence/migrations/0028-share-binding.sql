-- D08: member-made requests, preview-only share links and binding to one primary customer. Re-runnable.
ALTER TABLE finish_requests ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'customer' CHECK (origin IN ('customer', 'member'));
ALTER TABLE finish_requests ADD COLUMN IF NOT EXISTS created_by text;
UPDATE finish_requests SET created_by=customer_id WHERE created_by IS NULL;
ALTER TABLE finish_requests ALTER COLUMN created_by SET NOT NULL;
ALTER TABLE finish_requests ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE finish_requests DROP CONSTRAINT IF EXISTS finish_requests_customer_id_request_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS finish_requests_operation ON finish_requests(created_by, request_id);
-- Customer-origin requests always have their customer; member-origin requests get one by binding.
ALTER TABLE finish_requests DROP CONSTRAINT IF EXISTS finish_requests_customer_origin;
ALTER TABLE finish_requests ADD CONSTRAINT finish_requests_customer_origin CHECK (origin = 'member' OR customer_id IS NOT NULL);

CREATE TABLE IF NOT EXISTS request_shares (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES finish_requests(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  target_phone text,
  code_hash text, code_expires_at timestamptz, code_attempts integer NOT NULL DEFAULT 0, code_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz, revoked_by text,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_shares_request ON request_shares(request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS binding_applications (
  id uuid PRIMARY KEY,
  share_id uuid NOT NULL REFERENCES request_shares(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES finish_requests(id) ON DELETE CASCADE,
  applicant_id text NOT NULL, note text CHECK (note IS NULL OR length(note) <= 200),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  decided_by text, decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS binding_applications_pending ON binding_applications(request_id, applicant_id) WHERE status = 'pending';

-- Bind, unbind, revoke, apply and decisions all leave a record.
CREATE TABLE IF NOT EXISTS binding_events (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES finish_requests(id) ON DELETE CASCADE,
  share_id uuid REFERENCES request_shares(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('share', 'bind', 'unbind', 'revoke', 'apply', 'approve', 'reject')),
  method text CHECK (method IS NULL OR method IN ('phone', 'code', 'approval')),
  actor_id text NOT NULL, subject_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS binding_events_request ON binding_events(request_id, created_at);
