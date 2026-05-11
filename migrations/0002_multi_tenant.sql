-- Multi-tenant migration: add users table and user_id columns

-- Users table (Google OAuth)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  picture TEXT,
  google_doc_id TEXT,
  refresh_token TEXT,
  token_status TEXT NOT NULL DEFAULT 'active',
  owner_emails TEXT,
  owner_display_names TEXT,
  share_slug TEXT UNIQUE,
  created_at TEXT NOT NULL
);

-- Add user_id to sections
ALTER TABLE sections ADD COLUMN user_id TEXT;

-- Add user_id to annotations
ALTER TABLE annotations ADD COLUMN user_id TEXT;

-- Add user_id to progress_log
ALTER TABLE progress_log ADD COLUMN user_id TEXT;

-- Add user_id to sync_state
ALTER TABLE sync_state ADD COLUMN user_id TEXT;

-- Recreate paragraph_snapshots with user_id and updated unique constraint
-- SQLite doesn't support DROP CONSTRAINT, so we recreate the table
CREATE TABLE paragraph_snapshots_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id TEXT NOT NULL,
  paragraph_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  content_text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  user_id TEXT,
  UNIQUE(user_id, section_id, paragraph_index)
);

INSERT INTO paragraph_snapshots_new (id, section_id, paragraph_index, content_hash, content_text, updated_at)
  SELECT id, section_id, paragraph_index, content_hash, content_text, updated_at
  FROM paragraph_snapshots;

DROP TABLE paragraph_snapshots;

ALTER TABLE paragraph_snapshots_new RENAME TO paragraph_snapshots;

-- Remove old single-user data (sections are now created per-user during onboarding)
DELETE FROM annotations;
DELETE FROM progress_log;
DELETE FROM sync_state;
DELETE FROM sections;
