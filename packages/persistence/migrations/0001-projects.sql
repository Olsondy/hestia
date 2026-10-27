CREATE TABLE projects (
  id uuid PRIMARY KEY, owner_id text NOT NULL, name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  revision integer NOT NULL CHECK (revision > 0), snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_owner ON projects(owner_id, updated_at DESC);
CREATE TABLE project_revisions (
  project_id uuid NOT NULL REFERENCES projects(id), revision integer NOT NULL,
  snapshot jsonb NOT NULL, operation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id, revision)
);
CREATE TABLE operations (
  owner_id text NOT NULL, id uuid NOT NULL, project_id uuid NOT NULL REFERENCES projects(id),
  request_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, id)
);
CREATE TABLE resources (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
  object_key text NOT NULL UNIQUE, media_type text NOT NULL,
  state text NOT NULL CHECK(state IN ('pending', 'ready', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resources_project ON resources(project_id);
