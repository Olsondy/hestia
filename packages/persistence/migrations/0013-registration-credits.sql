-- Platform-maintained trial rules. An issued grant never changes when this row changes.
CREATE TABLE credit_rules (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  registration_grant integer NOT NULL CHECK (registration_grant BETWEEN 0 AND 1000000),
  qa_cost integer NOT NULL CHECK (qa_cost BETWEEN 1 AND 1000000),
  edit_cost integer NOT NULL CHECK (edit_cost BETWEEN 1 AND 1000000),
  design_cost integer NOT NULL CHECK (design_cost BETWEEN 1 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO credit_rules(singleton, registration_grant, qa_cost, edit_cost, design_cost) VALUES(true,40,1,5,20);

CREATE TABLE credit_accounts (
  user_id text PRIMARY KEY REFERENCES hestia_auth_user(id) ON DELETE CASCADE,
  available integer NOT NULL CHECK (available >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE credit_ledger (
  id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES hestia_auth_user(id) ON DELETE CASCADE,
  kind text NOT NULL, amount integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credit_single_registration_grant ON credit_ledger(user_id) WHERE kind='registration_grant';
CREATE INDEX credit_ledger_user_created ON credit_ledger(user_id, created_at DESC, id DESC);
