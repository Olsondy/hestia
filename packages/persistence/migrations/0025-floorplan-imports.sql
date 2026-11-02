-- D05: uploaded floor-plan drawings and their space candidates. A drawing belongs to a project (and through it to a
-- workspace); actor_id records who uploaded it and scopes idempotency, never access.
CREATE TABLE floorplan_imports (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id text NOT NULL, request_id uuid NOT NULL, request_hash text NOT NULL,
  resource_id uuid NOT NULL UNIQUE REFERENCES resources(id),
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200), file_format text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0), sha256 text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('automatic', 'assisted')),
  status text NOT NULL CHECK (status IN ('queued', 'converting', 'retry_wait', 'assisted_conversion', 'pending_review', 'failed')),
  generation integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0, lease_until timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0), error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, request_id)
);
CREATE INDEX floorplan_imports_project_recent ON floorplan_imports(project_id, created_at DESC);

-- One candidate per import revision: the unique key makes duplicate deliveries and restarted Workers unable to add a
-- second candidate for the same conversion. A member HouseSpec import creates the next revision.
CREATE TABLE floorplan_candidates (
  id uuid PRIMARY KEY, import_id uuid NOT NULL REFERENCES floorplan_imports(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE, import_revision integer NOT NULL,
  source text NOT NULL CHECK (source IN ('dxf-automatic', 'member-housespec')),
  generation integer, created_by text, review_status text NOT NULL CHECK (review_status IN ('pending_review')),
  house_spec jsonb NOT NULL, candidate jsonb, scene jsonb, issues jsonb NOT NULL, conversion jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, import_revision)
);
CREATE INDEX floorplan_candidates_project ON floorplan_candidates(project_id, created_at DESC);

CREATE TABLE floorplan_import_operations (
  actor_id text NOT NULL, id uuid NOT NULL, import_id uuid NOT NULL REFERENCES floorplan_imports(id) ON DELETE CASCADE,
  request_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, id)
);
