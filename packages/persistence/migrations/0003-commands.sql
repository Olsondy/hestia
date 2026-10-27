CREATE TABLE project_commands (
  owner_id text NOT NULL, operation_id uuid NOT NULL, project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type text NOT NULL CHECK(type IN ('move-furniture','set-lock','undo')), object_id text NOT NULL,
  revision integer NOT NULL CHECK(revision>0), layout_id uuid NOT NULL,
  fixed_facts_id uuid NOT NULL, fixed_facts_revision integer NOT NULL,
  before_value jsonb NOT NULL, after_value jsonb NOT NULL,
  undo_of uuid, undone_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,operation_id),
  FOREIGN KEY(owner_id,operation_id) REFERENCES operations(owner_id,id) ON DELETE CASCADE,
  UNIQUE(project_id,revision)
);
CREATE INDEX project_commands_recent ON project_commands(project_id,revision DESC);
CREATE INDEX project_commands_dependencies ON project_commands(project_id,object_id,revision DESC);
