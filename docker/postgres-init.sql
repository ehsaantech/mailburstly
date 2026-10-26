-- Postgres init script, run once on first boot of the postgres container.
-- Creates the two databases on the same instance: `mailrung` (ours) and
-- `emailengine` (EmailEngine's own). Keeping them separate means EmailEngine
-- can never accidentally touch our schema, and we can never accidentally
-- touch its.

-- Create the emailengine database if it does not exist. There is no
-- `CREATE DATABASE IF NOT EXISTS` in Postgres, so we guard with a query.
SELECT 'CREATE DATABASE emailengine'
  WHERE NOT EXISTS (
    SELECT FROM pg_database WHERE datname = 'emailengine'
  );
\gexec