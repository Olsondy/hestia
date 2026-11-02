-- D02: phone-number sign-in for customers entering through a workspace's customer entry, and the customer relation.
-- Customers are never workspace members, so project_access and every existing capability are unchanged;
-- later tickets (D06/D08) add customer `via` values explicitly. Idempotent: re-applying changes nothing.

-- One account per phone number across the platform, stored as +86 followed by the mainland mobile number.
-- A phone-only account has no email; every account keeps at least one sign-in identifier.
ALTER TABLE hestia_auth_user ADD COLUMN IF NOT EXISTS phone_number text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hestia_auth_user_phone_normalized') THEN
    ALTER TABLE hestia_auth_user ADD CONSTRAINT hestia_auth_user_phone_normalized CHECK (phone_number ~ '^\+861[3-9][0-9]{9}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hestia_auth_user_identifier') THEN
    ALTER TABLE hestia_auth_user ADD CONSTRAINT hestia_auth_user_identifier CHECK (email IS NOT NULL OR phone_number IS NOT NULL);
  END IF;
END $$;
ALTER TABLE hestia_auth_user ALTER COLUMN email DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hestia_auth_user_phone_number ON hestia_auth_user(phone_number) WHERE phone_number IS NOT NULL;

-- Whether workspaces of a type have a public customer entry (H5 path by slug). Data, not a code branch.
ALTER TABLE workspace_types ADD COLUMN IF NOT EXISTS customer_entry boolean NOT NULL DEFAULT false;
UPDATE workspace_types SET customer_entry = true WHERE kind = 'enterprise' AND NOT customer_entry;

-- One row per code sent. Only an HMAC of the code is stored. Rows double as the send log for rate limits.
CREATE TABLE IF NOT EXISTS phone_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL CHECK (phone_number ~ '^\+861[3-9][0-9]{9}$'),
  -- HMAC of the request source (trusted client IP header, or one shared bucket); raw addresses are not stored.
  source_hash text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  -- Set when a newer code is sent to the same number; only the newest code is ever accepted.
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS phone_otp_challenges_phone ON phone_otp_challenges(phone_number, created_at DESC);
CREATE INDEX IF NOT EXISTS phone_otp_challenges_source ON phone_otp_challenges(source_hash, created_at DESC);

-- Customer relation: the account signed in through this workspace's entry. Not a membership; grants nothing yet.
CREATE TABLE IF NOT EXISTS workspace_customers (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES hestia_auth_user(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_customers_user ON workspace_customers(user_id);
