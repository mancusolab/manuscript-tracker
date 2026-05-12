-- Fix sections table: use composite primary key (id, user_id) for multi-tenant support
-- Also remove FK constraints from annotations and progress_log that block the migration

-- Recreate annotations without FK to sections
CREATE TABLE annotations_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id TEXT NOT NULL,
  paragraph_index INTEGER NOT NULL,
  paragraph_snippet TEXT,
  author_email TEXT NOT NULL,
  author_name TEXT NOT NULL,
  change_type TEXT NOT NULL DEFAULT 'modified',
  google_comment_id TEXT,
  status TEXT NOT NULL DEFAULT 'needs_review',
  addressed_by TEXT,
  addressed_at TEXT,
  addressed_note TEXT,
  created_at TEXT NOT NULL,
  comment_text TEXT,
  user_id TEXT
);
INSERT INTO annotations_new SELECT * FROM annotations;
DROP TABLE annotations;
ALTER TABLE annotations_new RENAME TO annotations;

-- Recreate progress_log without FK to sections
CREATE TABLE progress_log_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  logged_by TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  user_id TEXT
);
INSERT INTO progress_log_new SELECT * FROM progress_log;
DROP TABLE progress_log;
ALTER TABLE progress_log_new RENAME TO progress_log;

-- Recreate sections with composite primary key
CREATE TABLE sections_new (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  heading_pattern TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  last_edited_by TEXT,
  last_edited_at TEXT,
  sort_order INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (id, user_id)
);
INSERT INTO sections_new (id, name, heading_pattern, status, last_edited_by, last_edited_at, sort_order, user_id)
  SELECT id, name, heading_pattern, status, last_edited_by, last_edited_at, sort_order, user_id
  FROM sections WHERE user_id IS NOT NULL;
DROP TABLE sections;
ALTER TABLE sections_new RENAME TO sections;
