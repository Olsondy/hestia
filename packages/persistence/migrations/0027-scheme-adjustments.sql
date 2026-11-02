-- D07: customer adjustments (scheme revisions), confirmations and messages. Re-runnable.
CREATE TABLE IF NOT EXISTS finish_scheme_revisions (
  scheme_id uuid NOT NULL REFERENCES finish_schemes(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  surface_design jsonb NOT NULL, report jsonb NOT NULL,
  render_id uuid REFERENCES project_renders(id) ON DELETE SET NULL,
  change jsonb, created_by text, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scheme_id, revision)
);
-- Backfill revision 1 for schemes generated before D07.
INSERT INTO finish_scheme_revisions(scheme_id,revision,surface_design,report,render_id)
  SELECT id, revision, surface_design, report, render_id FROM finish_schemes ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS finish_request_events (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES finish_requests(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('confirmation', 'message')),
  scheme_id uuid REFERENCES finish_schemes(id) ON DELETE SET NULL, scheme_revision integer,
  surface_design jsonb, message text CHECK (message IS NULL OR length(message) <= 500),
  contact_requested boolean NOT NULL DEFAULT false, preferred_time text CHECK (preferred_time IS NULL OR length(preferred_time) <= 40),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finish_request_events_request ON finish_request_events(request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS finish_request_operations (
  actor_id text NOT NULL, id uuid NOT NULL, request_id uuid NOT NULL REFERENCES finish_requests(id) ON DELETE CASCADE,
  request_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, id)
);
