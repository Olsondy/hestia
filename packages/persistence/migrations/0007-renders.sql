CREATE TABLE project_renders (
  id uuid PRIMARY KEY, owner_id text NOT NULL, project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  request_id uuid NOT NULL, request_hash text NOT NULL, source jsonb NOT NULL, snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL, asset_version text NOT NULL, renderer_version text NOT NULL,
  scale text NOT NULL, synthetic boolean NOT NULL, concept boolean NOT NULL, label text NOT NULL,
  status text NOT NULL CHECK(status IN ('queued','running','retry_wait','completed','failed')),
  generation integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0, lease_until timestamptz,
  resource_id uuid REFERENCES resources(id), width integer, height integer, image_hash text, error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,request_id)
);
CREATE INDEX project_renders_recent ON project_renders(owner_id,project_id,created_at DESC);
CREATE TABLE render_attempts (
  render_id uuid NOT NULL REFERENCES project_renders(id) ON DELETE CASCADE, generation integer NOT NULL,
  resource_id uuid NOT NULL REFERENCES resources(id), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(render_id,generation), UNIQUE(resource_id)
);
