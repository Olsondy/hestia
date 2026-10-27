ALTER TABLE design_tasks DROP CONSTRAINT design_tasks_protocol_check;
ALTER TABLE design_tasks ADD CONSTRAINT design_tasks_protocol_check CHECK(protocol IN ('deterministic-v1','conversation-v1'));
ALTER TABLE design_tasks ADD COLUMN conversation jsonb;
ALTER TABLE design_tasks ADD CONSTRAINT design_tasks_conversation_check CHECK(
  (protocol='deterministic-v1' AND conversation IS NULL) OR
  (protocol='conversation-v1' AND conversation IS NOT NULL)
);
