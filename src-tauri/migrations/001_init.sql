PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS task_categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  color       TEXT NOT NULL DEFAULT '#64748b',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'todo'
                 CHECK (status IN ('todo','in_progress','completed')),
  priority       TEXT NOT NULL DEFAULT 'medium'
                 CHECK (priority IN ('low','medium','high','urgent')),
  category_id    TEXT REFERENCES task_categories(id) ON DELETE SET NULL,
  planned_start  TEXT,
  due_at         TEXT,
  actual_start   TEXT,
  completed_at   TEXT,
  notes          TEXT,
  sort_order     REAL NOT NULL DEFAULT 0,
  google_event_id TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_due      ON tasks(due_at)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category_id);

CREATE TABLE IF NOT EXISTS task_status_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event        TEXT NOT NULL CHECK (event IN ('created','status_changed','reopened','completed','edited','deleted','restored')),
  from_status  TEXT,
  to_status    TEXT,
  note         TEXT,
  changed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  was_late     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_history_task ON task_status_history(task_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_history_time ON task_status_history(changed_at);

CREATE TABLE IF NOT EXISTS google_accounts (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  scopes        TEXT NOT NULL,
  connected_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  needs_reauth  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS google_calendar_sync (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL REFERENCES google_accounts(id) ON DELETE CASCADE,
  calendar_id    TEXT NOT NULL,
  summary        TEXT,
  selected       INTEGER NOT NULL DEFAULT 0,
  sync_token     TEXT,
  last_synced_at TEXT,
  last_error     TEXT,
  UNIQUE (account_id, calendar_id)
);

CREATE TABLE IF NOT EXISTS agendas (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description     TEXT,
  start_at        TEXT NOT NULL,
  end_at          TEXT NOT NULL,
  all_day         INTEGER NOT NULL DEFAULT 0,
  location        TEXT,
  category        TEXT NOT NULL DEFAULT 'other'
                  CHECK (category IN ('meeting','appointment','personal','office','reminder','other')),
  sync_calendar_id TEXT REFERENCES google_calendar_sync(id) ON DELETE SET NULL,
  google_event_id TEXT,
  google_etag     TEXT,
  google_updated  TEXT,
  sync_status     TEXT NOT NULL DEFAULT 'local_only'
                  CHECK (sync_status IN ('local_only','synced','pending_push','pending_delete','conflict','error')),
  sync_error      TEXT,
  last_synced_at  TEXT,
  base_snapshot   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at      TEXT,
  CHECK (end_at >= start_at)
);
CREATE INDEX IF NOT EXISTS idx_agendas_start ON agendas(start_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agendas_sync  ON agendas(sync_status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agenda_google_event
  ON agendas(sync_calendar_id, google_event_id) WHERE google_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agenda_task_relations (
  agenda_id  TEXT NOT NULL REFERENCES agendas(id) ON DELETE CASCADE,
  task_id    TEXT NOT NULL REFERENCES tasks(id)   ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (agenda_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_atr_task ON agenda_task_relations(task_id);

CREATE TABLE IF NOT EXISTS reminders (
  id             TEXT PRIMARY KEY,
  target_type    TEXT NOT NULL CHECK (target_type IN ('task','agenda')),
  target_id      TEXT NOT NULL,
  offset_minutes INTEGER NOT NULL,
  remind_at      TEXT NOT NULL,
  fired_at       TEXT,
  dismissed      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (target_type, target_id, offset_minutes)
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(remind_at) WHERE fired_at IS NULL AND dismissed = 0;

CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  summary     TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_time ON activity_log(created_at DESC);

CREATE TABLE IF NOT EXISTS application_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO application_settings(key, value) VALUES
  ('theme','light'), ('language','id'), ('date_format','DD/MM/YYYY'),
  ('user_name',''), ('notifications_enabled','true'),
  ('default_agenda_reminder_min','10'), ('default_task_reminder_min','1440'),
  ('widget_opacity','0.92'), ('widget_visible','true'),
  ('widget_x',''), ('widget_y',''), ('widget_w','320'), ('widget_h','520'),
  ('autostart','false');

INSERT OR IGNORE INTO task_categories(id, name, color) VALUES
  ('cat-work','Pekerjaan','#3b82f6'),
  ('cat-personal','Pribadi','#8b5cf6'),
  ('cat-study','Belajar','#14b8a6'),
  ('cat-other','Lainnya','#64748b');