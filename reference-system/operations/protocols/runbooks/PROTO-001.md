---
id: PROTO-001
title: PostgreSQL Schema Migration Deployment
domain: database
status: active
---

# PROTO-001

## PURPOSE

This protocol covers deploying schema migrations to the production PostgreSQL database. It applies to any DDL change: table creation, column additions, index creation, constraint modifications, or enum type changes. Follow this protocol exactly — ad-hoc schema changes to production are prohibited.

## PREREQUISITES

- Production database credentials available via `op run` (1Password CLI)
- Migration files committed and reviewed in a merged PR
- Migrations tested against a copy of the production schema in staging
- Maintenance window scheduled if the migration requires an exclusive lock

> If the migration adds a NOT NULL column to a table with more than 1 million rows, it MUST be done in two steps: add the column as nullable, backfill, then add the constraint. Single-step NOT NULL additions will lock the table for the duration of the backfill.

```bash
# Verify migration files are in the expected directory
ls -la migrations/pending/
```

## STEPS

### Pre-flight Checks

1. Confirm the migration has been tested in staging:

```bash
DATABASE_URL="$STAGING_DB_URL" npx prisma migrate status
```

2. Take a logical backup of affected tables:

```bash
pg_dump --table=affected_table --data-only \
  --format=custom \
  -f "backup_$(date +%Y%m%d_%H%M%S).dump" \
  "$PRODUCTION_DB_URL"
```

3. Check active connections and running queries:

```bash
psql "$PRODUCTION_DB_URL" -c "
  SELECT pid, now() - pg_stat_activity.query_start AS duration, query
  FROM pg_stat_activity
  WHERE state != 'idle'
  ORDER BY duration DESC;
"
```

> If any query has been running longer than 5 minutes, investigate before proceeding. Long-running queries can block DDL operations and cause cascading lock waits.

### Apply Migration

4. Set a statement timeout to prevent runaway migrations:

```bash
psql "$PRODUCTION_DB_URL" -c "SET statement_timeout = '300s';" -c "\i migrations/pending/001_add_column.sql"
```

5. Verify the schema change took effect:

```bash
psql "$PRODUCTION_DB_URL" -c "\d affected_table"
```

### Post-migration Verification

6. Run the application's health check endpoint to confirm connectivity:

```bash
curl -f https://api.example.com/health
```

7. Check application logs for any schema-related errors in the first 5 minutes after migration.

## ROLLBACK

If the migration fails or causes application errors, reverse it immediately.

> Do not attempt to fix a broken migration in production. Roll back, investigate in staging, and re-attempt with a corrected migration file.

1. Apply the corresponding rollback migration:

```bash
psql "$PRODUCTION_DB_URL" -c "SET statement_timeout = '300s';" -c "\i migrations/pending/001_add_column.rollback.sql"
```

2. Verify the rollback restored the original schema:

```bash
psql "$PRODUCTION_DB_URL" -c "\d affected_table"
```

3. Restart application pods to clear any cached schema state:

```bash
kubectl rollout restart deployment/api-server -n production
```

## VALIDATION

1. Confirm migration status shows no pending migrations:

```bash
DATABASE_URL="$PRODUCTION_DB_URL" npx prisma migrate status
```

2. Run the integration test suite against production:

```bash
DATABASE_URL="$PRODUCTION_DB_URL" npm run test:integration -- --tag=schema
```

3. Check Grafana dashboard for query latency regression in the 30 minutes following the migration

## NOTES

- Index creation on large tables should always use `CREATE INDEX CONCURRENTLY` to avoid blocking writes. This cannot run inside a transaction, so it must be a standalone migration step.
- Enum type changes in PostgreSQL are not transactional in all cases. Adding a value works, but removing or renaming values requires creating a new type and migrating the column.
