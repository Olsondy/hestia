CREATE TABLE candidates (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id text NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  revision integer NOT NULL CHECK(revision>0), base_revision integer NOT NULL CHECK(base_revision>0),
  base_state jsonb NOT NULL, objects jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('draft','checked','adopted')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidates_project ON candidates(project_id,updated_at DESC);
CREATE TABLE candidate_revisions (
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK(revision>0), objects jsonb NOT NULL,
  PRIMARY KEY(candidate_id,revision)
);
CREATE TABLE candidate_checks (
  id uuid PRIMARY KEY, candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  candidate_revision integer NOT NULL, base_revision integer NOT NULL,
  content_hash text NOT NULL, checker_version text NOT NULL, report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(candidate_id,candidate_revision) REFERENCES candidate_revisions(candidate_id,revision) ON DELETE CASCADE
);
CREATE TABLE candidate_presentations (
  id uuid PRIMARY KEY, candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  candidate_revision integer NOT NULL, base_revision integer NOT NULL,
  check_id uuid NOT NULL REFERENCES candidate_checks(id) ON DELETE CASCADE,
  owner_id text NOT NULL, session_hash text NOT NULL, content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE candidate_selections (
  id uuid PRIMARY KEY, presentation_id uuid NOT NULL REFERENCES candidate_presentations(id) ON DELETE CASCADE,
  owner_id text NOT NULL, session_hash text NOT NULL, adopted_operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE candidate_adoptions (
  operation_id uuid PRIMARY KEY, owner_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id), candidate_revision integer NOT NULL,
  selection_id uuid NOT NULL UNIQUE REFERENCES candidate_selections(id),
  revision integer NOT NULL CHECK(revision>0), before_layout jsonb NOT NULL, after_layout jsonb NOT NULL,
  fixed_facts_hash text NOT NULL, undone_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(owner_id,operation_id) REFERENCES operations(owner_id,id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(project_id,revision)
);
CREATE INDEX candidate_adoptions_recent ON candidate_adoptions(project_id,revision DESC);
