CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  legacy_imported INTEGER NOT NULL DEFAULT 0 CHECK(legacy_imported IN (0,1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE pools (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 50),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL UNIQUE REFERENCES pools(id),
  serial TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'simulation' CHECK(mode = 'simulation'),
  paired INTEGER NOT NULL DEFAULT 0 CHECK(paired IN (0,1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  paired_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE notification_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  phone INTEGER NOT NULL DEFAULT 1 CHECK(phone IN (0,1)),
  sound INTEGER NOT NULL DEFAULT 1 CHECK(sound IN (0,1)),
  escalate INTEGER NOT NULL DEFAULT 1 CHECK(escalate IN (0,1)),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
  phone TEXT NOT NULL CHECK(length(phone) BETWEEN 8 AND 16),
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, phone)
) STRICT;

CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  pool_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('simulation','legacy_import')),
  occurred_at TEXT NOT NULL,
  acknowledged_at TEXT,
  CHECK(acknowledged_at IS NULL OR acknowledged_at >= occurred_at)
) STRICT;
CREATE INDEX alerts_device_time ON alerts(device_id, occurred_at DESC);
CREATE UNIQUE INDEX alerts_one_active ON alerts(device_id) WHERE acknowledged_at IS NULL;

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  action TEXT NOT NULL,
  entity_id TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX audit_workspace_time ON audit_log(workspace_id, created_at DESC);
