-- ADR-0017 / M02: existing phone-only accounts become accounts of the one enterprise they are a customer of.
-- Accounts with no customer relation stay platform accounts. An account that is a customer of more than one
-- enterprise is two people's worth of history under one id: refuse, list them, and let a maintainer split them.
DO $$
DECLARE shared text;
BEGIN
  SELECT string_agg(user_id, ', ') INTO shared FROM (
    SELECT wc.user_id FROM workspace_customers wc JOIN hestia_auth_user u ON u.id = wc.user_id
    WHERE u.phone_number IS NOT NULL AND u.email IS NULL AND u.workspace_id IS NULL
    GROUP BY wc.user_id HAVING count(DISTINCT wc.workspace_id) > 1) t;
  IF shared IS NOT NULL THEN
    RAISE EXCEPTION 'Customer accounts of more than one enterprise must be split before migrating (ADR-0017): %', shared;
  END IF;
END $$;--> statement-breakpoint
UPDATE hestia_auth_user u SET workspace_id = wc.workspace_id
FROM workspace_customers wc
WHERE wc.user_id = u.id AND u.phone_number IS NOT NULL AND u.email IS NULL AND u.workspace_id IS NULL;
