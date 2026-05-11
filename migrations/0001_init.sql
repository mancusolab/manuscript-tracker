-- Manuscript sections
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  heading_pattern TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  last_edited_by TEXT,
  last_edited_at TEXT,
  sort_order INTEGER NOT NULL
);

-- Google Docs revisions
CREATE TABLE IF NOT EXISTS revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_revision_id TEXT UNIQUE NOT NULL,
  author_email TEXT NOT NULL,
  author_name TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  sections_affected TEXT NOT NULL DEFAULT '[]'
);

-- Paragraph-level annotations
CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id TEXT NOT NULL REFERENCES sections(id),
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
  FOREIGN KEY (section_id) REFERENCES sections(id)
);

-- Manual progress log entries
CREATE TABLE IF NOT EXISTS progress_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id TEXT NOT NULL REFERENCES sections(id),
  status TEXT NOT NULL,
  note TEXT,
  logged_by TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (section_id) REFERENCES sections(id)
);

-- Stored paragraph snapshots for diffing
CREATE TABLE IF NOT EXISTS paragraph_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id TEXT NOT NULL,
  paragraph_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  content_text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(section_id, paragraph_index)
);

-- Sync state
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed the 6 manuscript sections
INSERT OR IGNORE INTO sections (id, name, heading_pattern, status, sort_order) VALUES
  ('abstract', 'Abstract', 'Abstract', 'draft', 1),
  ('introduction', 'Introduction', 'Introduction', 'draft', 2),
  ('materials-methods', 'Materials and Methods', 'Material', 'draft', 3),
  ('results', 'Results', 'Results', 'draft', 4),
  ('discussion', 'Discussion', 'Discussion', 'draft', 5),
  ('supplement', 'Supplement', 'Supplement', 'draft', 6);
