CREATE TABLE hestia_auth_user (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false, image text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hestia_auth_email_normalized CHECK (email = lower(email))
);
CREATE TABLE hestia_auth_session (
  id text PRIMARY KEY, expires_at timestamptz NOT NULL, token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text, user_agent text, user_id text NOT NULL REFERENCES hestia_auth_user(id) ON DELETE CASCADE
);
CREATE INDEX hestia_auth_session_user ON hestia_auth_session(user_id);
CREATE TABLE hestia_auth_account (
  id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES hestia_auth_user(id) ON DELETE CASCADE,
  access_token text, refresh_token text, id_token text,
  access_token_expires_at timestamptz, refresh_token_expires_at timestamptz,
  scope text, password text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hestia_auth_account_user ON hestia_auth_account(user_id);
CREATE UNIQUE INDEX hestia_auth_account_provider ON hestia_auth_account(provider_id, account_id);
CREATE TABLE hestia_auth_verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hestia_auth_verification_identifier ON hestia_auth_verification(identifier);
CREATE TABLE hestia_invitation (
  id text PRIMARY KEY, email text NOT NULL, token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), consumed_at timestamptz,
  user_id text REFERENCES hestia_auth_user(id) ON DELETE SET NULL,
  CONSTRAINT hestia_invitation_email_normalized CHECK (email = lower(email))
);
