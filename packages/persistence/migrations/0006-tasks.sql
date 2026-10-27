CREATE TABLE design_tasks (
  id uuid PRIMARY KEY, owner_id text NOT NULL, project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  request_id uuid NOT NULL, request_hash text NOT NULL, protocol text NOT NULL CHECK(protocol='deterministic-v1'),
  status text NOT NULL CHECK(status IN ('queued','running','retry_wait','completed','partial','failed','cancelled')),
  steps jsonb NOT NULL, next_step integer NOT NULL DEFAULT 0 CHECK(next_step>=0),
  expected_revision integer NOT NULL CHECK(expected_revision>0), generation integer NOT NULL DEFAULT 0 CHECK(generation>=0),
  lease_until timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  usage_limit integer NOT NULL DEFAULT 8 CHECK(usage_limit>0), usage_used integer NOT NULL DEFAULT 0 CHECK(usage_used>=0),
  usage_reserved integer NOT NULL DEFAULT 0 CHECK(usage_reserved BETWEEN 0 AND 1),
  event_seq integer NOT NULL DEFAULT 0 CHECK(event_seq>=0), error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,request_id), CHECK(usage_used+usage_reserved<=usage_limit)
);
CREATE UNIQUE INDEX design_tasks_one_active ON design_tasks(project_id) WHERE status IN ('queued','running','retry_wait');
CREATE INDEX design_tasks_owner_project ON design_tasks(owner_id,project_id,created_at DESC);
CREATE TABLE task_events (
  task_id uuid NOT NULL REFERENCES design_tasks(id) ON DELETE CASCADE, seq integer NOT NULL,
  type text NOT NULL CHECK(type IN ('status','text','operation','usage')), data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(task_id,seq)
);
