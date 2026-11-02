-- D04: stone surface design on finishes. Re-runnable.
CREATE TABLE IF NOT EXISTS workspace_stones (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stone_id text NOT NULL CHECK (length(stone_id) BETWEEN 1 AND 120),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  spec jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, stone_id, version)
);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS surface_design jsonb;
ALTER TABLE candidate_revisions ADD COLUMN IF NOT EXISTS surface_design jsonb;
ALTER TABLE candidate_adoptions ADD COLUMN IF NOT EXISTS before_surface jsonb;
ALTER TABLE candidate_adoptions ADD COLUMN IF NOT EXISTS after_surface jsonb;
ALTER TABLE candidate_adoptions DROP CONSTRAINT IF EXISTS candidate_adoptions_change_kind_check;
ALTER TABLE candidate_adoptions ADD CONSTRAINT candidate_adoptions_change_kind_check
  CHECK (change_kind IN ('layout', 'style', 'surface', 'mixed'));
