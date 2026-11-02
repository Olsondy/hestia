-- H01: customer taste recorded with a finish request (色调、铺法、波打线偏好). Re-runnable.
ALTER TABLE finish_requests ADD COLUMN IF NOT EXISTS preferences jsonb;
