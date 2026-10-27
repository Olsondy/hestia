-- D01 expand: workspaces become the owner of projects and everything scoped by a project.
-- Every statement is idempotent so this file can be re-applied to a database that already has it,
-- including after 0015 has removed the legacy user-ownership column.
CREATE TABLE IF NOT EXISTS workspace_types (
  kind text PRIMARY KEY CHECK (kind ~ '^[a-z][a-z0-9-]{1,31}$'),
  -- NULL means no fixed member limit. Capability differences live here or in workspaces.settings, never in code branches.
  max_members integer CHECK (max_members IS NULL OR max_members > 0),
  -- member_credits: usage is charged to the single member's C01 credit account; unmetered: no credit rule yet.
  usage_policy text NOT NULL CHECK (usage_policy IN ('member_credits', 'unmetered')),
  -- per_user: provisioned automatically, one per account; explicit: created by a trusted script or service call.
  provisioning text NOT NULL CHECK (provisioning IN ('per_user', 'explicit')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_types_single_per_user ON workspace_types(provisioning) WHERE provisioning = 'per_user';
INSERT INTO workspace_types(kind, max_members, usage_policy, provisioning)
VALUES ('personal', 1, 'member_credits', 'per_user'), ('enterprise', NULL, 'unmetered', 'explicit')
ON CONFLICT (kind) DO NOTHING;

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL REFERENCES workspace_types(kind),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  -- Stable public identifier for scripted creation and future entry paths; personal workspaces have none.
  slug text UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  -- At most one automatically provisioned personal workspace per account.
  personal_user_id text UNIQUE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_members_user ON workspace_members(user_id);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by text;
CREATE INDEX IF NOT EXISTS projects_workspace ON projects(workspace_id, updated_at DESC);

-- Creates missing personal workspaces and moves legacy user-owned projects into them.
-- Safe to call repeatedly; never creates a second personal workspace or changes an assigned project.
CREATE OR REPLACE FUNCTION hestia_backfill_personal_workspaces() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  legacy boolean := EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'projects' AND column_name = 'owner_id');
  per_user text := (SELECT kind FROM workspace_types WHERE provisioning = 'per_user');
BEGIN
  INSERT INTO workspaces(kind, name, personal_user_id)
    SELECT per_user, '个人工作空间', id FROM hestia_auth_user ORDER BY id
    ON CONFLICT (personal_user_id) DO NOTHING;
  IF legacy THEN
    EXECUTE $sql$INSERT INTO workspaces(kind, name, personal_user_id)
      SELECT DISTINCT $1, '个人工作空间', owner_id FROM projects WHERE workspace_id IS NULL ORDER BY 3
      ON CONFLICT (personal_user_id) DO NOTHING$sql$ USING per_user;
  END IF;
  INSERT INTO workspace_members(workspace_id, user_id, role)
    SELECT id, personal_user_id, 'admin' FROM workspaces WHERE personal_user_id IS NOT NULL
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
  IF legacy THEN
    EXECUTE $sql$UPDATE projects p SET workspace_id = w.id, created_by = COALESCE(p.created_by, p.owner_id)
      FROM workspaces w WHERE p.workspace_id IS NULL AND w.personal_user_id = p.owner_id$sql$;
  END IF;
END $$;
SELECT hestia_backfill_personal_workspaces();

-- Single authorization source for project-scoped data. Each row says who may use a project and through
-- which relation. Members are the only relation in D01; customer relations (D02/D08) add rows with another
-- `via`, and callers choose which relations a capability accepts.
CREATE OR REPLACE VIEW project_access AS
  SELECT p.id AS project_id, p.workspace_id, m.user_id, 'member'::text AS via, m.role
  FROM projects p JOIN workspace_members m ON m.workspace_id = p.workspace_id;
