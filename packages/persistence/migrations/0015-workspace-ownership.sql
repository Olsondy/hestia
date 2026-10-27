-- D01 contract: projects belong only to a workspace. User columns left on project-scoped records name the
-- actor who performed an operation (idempotency scope, audit, explicit user selection) and never grant access.
-- Idempotent like 0014: re-applying it changes nothing.

-- Pick up projects written by pre-workspace code after 0014 ran.
SELECT hestia_backfill_personal_workspaces();
ALTER TABLE projects ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE projects ALTER COLUMN created_by SET NOT NULL;
DROP INDEX IF EXISTS projects_owner;
ALTER TABLE projects DROP COLUMN IF EXISTS owner_id;

DO $$
DECLARE t text; r record;
BEGIN
  FOREACH t IN ARRAY ARRAY['operations', 'project_commands', 'underlay_operations', 'candidates', 'candidate_presentations',
    'candidate_selections', 'candidate_adoptions', 'design_tasks', 'project_renders', 'project_style_commands'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = t AND column_name = 'owner_id') THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN owner_id TO actor_id', t);
    END IF;
  END LOOP;
  FOR r IN SELECT c.conrelid::regclass AS tbl, c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = current_schema() AND c.conname LIKE '%owner\_id%' LOOP
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, replace(r.conname, 'owner_id', 'actor_id'));
  END LOOP;
END $$;

-- Project-scoped listings no longer filter by user.
DROP INDEX IF EXISTS design_tasks_owner_project;
CREATE INDEX IF NOT EXISTS design_tasks_project_recent ON design_tasks(project_id, created_at DESC);
DROP INDEX IF EXISTS project_renders_recent;
CREATE INDEX IF NOT EXISTS project_renders_project_recent ON project_renders(project_id, created_at DESC);
