-- Preserve historical migrations. Normalize the generic contact organization default.
ALTER TABLE "contacts" ALTER COLUMN "org" SET DEFAULT 'Task Manager';

