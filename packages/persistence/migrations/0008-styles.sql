ALTER TABLE candidates ADD COLUMN visual_style jsonb;
ALTER TABLE candidate_revisions ADD COLUMN visual_style jsonb;
ALTER TABLE candidate_adoptions ADD COLUMN before_style jsonb;
ALTER TABLE candidate_adoptions ADD COLUMN after_style jsonb;
ALTER TABLE candidate_adoptions ADD COLUMN change_kind text NOT NULL DEFAULT 'layout' CHECK(change_kind IN ('layout','style','mixed'));
CREATE TABLE project_style_commands (
  operation_id uuid PRIMARY KEY, owner_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK(revision>0), command jsonb NOT NULL,
  before_style jsonb, after_style jsonb NOT NULL,
  layout_hash text NOT NULL, fixed_facts_hash text NOT NULL, undone_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(owner_id,operation_id) REFERENCES operations(owner_id,id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  UNIQUE(project_id,revision)
);
CREATE INDEX project_style_commands_recent ON project_style_commands(project_id,revision DESC);
