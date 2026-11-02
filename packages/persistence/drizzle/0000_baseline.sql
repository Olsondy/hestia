-- Baseline only: every object in meta/0000_snapshot.json is created by the frozen legacy chain in
-- packages/persistence/migrations (0001–0029), which scripts/migrate.ts runs first. Intentionally no DDL here.
SELECT 1;
