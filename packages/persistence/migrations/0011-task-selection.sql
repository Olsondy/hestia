ALTER TABLE design_tasks DROP CONSTRAINT design_tasks_status_check;
ALTER TABLE design_tasks ADD CONSTRAINT design_tasks_status_check CHECK(status IN ('queued','running','retry_wait','waiting_input','waiting_selection','completed','partial','failed','cancelled'));
DROP INDEX design_tasks_one_active;
CREATE UNIQUE INDEX design_tasks_one_active ON design_tasks(project_id) WHERE status IN ('queued','running','retry_wait','waiting_input','waiting_selection');
