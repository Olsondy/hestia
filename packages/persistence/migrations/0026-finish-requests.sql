-- D06: customer finish requests (方案需求) and their tiling schemes. A request is also the enterprise's lead.
CREATE TABLE IF NOT EXISTS finish_requests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  project_id uuid NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  request_id uuid NOT NULL, request_hash text NOT NULL,
  source text NOT NULL CHECK (source IN ('demo-villa', 'drawing')),
  floorplan_import_id uuid REFERENCES floorplan_imports(id) ON DELETE SET NULL,
  finish_ids jsonb NOT NULL DEFAULT '[]'::jsonb, stones jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text CHECK (note IS NULL OR length(note) <= 500),
  status text NOT NULL CHECK (status IN ('awaiting_drawing', 'converting', 'pending_review', 'published')),
  review_reason text, published_at timestamptz, published_by text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, request_id)
);
CREATE INDEX IF NOT EXISTS finish_requests_workspace ON finish_requests(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS finish_requests_customer ON finish_requests(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS finish_schemes (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES finish_requests(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 3),
  name text NOT NULL, summary text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  surface_design jsonb NOT NULL, report jsonb NOT NULL,
  render_id uuid REFERENCES project_renders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, ordinal)
);
