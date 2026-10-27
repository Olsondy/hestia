CREATE TABLE project_underlays (
  project_id uuid PRIMARY KEY REFERENCES projects(id), resource_id uuid NOT NULL REFERENCES resources(id),
  version integer NOT NULL CHECK (version > 0), view jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE underlay_operations (
  owner_id text NOT NULL, id uuid NOT NULL, project_id uuid NOT NULL REFERENCES projects(id),
  resource_id uuid NOT NULL REFERENCES resources(id), request_hash text NOT NULL,
  result jsonb, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,id)
);
CREATE INDEX underlay_operations_project ON underlay_operations(project_id);
