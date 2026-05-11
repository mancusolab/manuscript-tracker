export type SectionStatus = 'draft' | 'in_review' | 'edited' | 'needs_review' | 'complete';
export type AnnotationStatus = 'needs_review' | 'addressed';
export type ChangeType = 'added' | 'modified' | 'deleted' | 'commented';

export interface Section {
  id: string;
  name: string;
  heading_pattern: string;
  status: SectionStatus;
  last_edited_by: string | null;
  last_edited_at: string | null;
  sort_order: number;
}

export interface SectionWithStats extends Section {
  unresolved_count: number;
  total_annotations: number;
}

export interface Revision {
  id: number;
  google_revision_id: string;
  author_email: string;
  author_name: string;
  timestamp: string;
  sections_affected: string;
}

export interface Annotation {
  id: number;
  section_id: string;
  paragraph_index: number;
  paragraph_snippet: string | null;
  author_email: string;
  author_name: string;
  change_type: ChangeType;
  google_comment_id: string | null;
  status: AnnotationStatus;
  addressed_by: string | null;
  addressed_at: string | null;
  addressed_note: string | null;
  created_at: string;
}

export interface ProgressEntry {
  id: number;
  section_id: string;
  status: string;
  note: string | null;
  logged_by: string;
  timestamp: string;
}

export interface ParagraphSnapshot {
  section_id: string;
  paragraph_index: number;
  content_hash: string;
  content_text: string;
}

export interface ParsedSection {
  id: string;
  paragraphs: { index: number; text: string; hash: string }[];
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  google_doc_id: string | null;
  refresh_token: string | null;
  token_status: string;
  owner_emails: string | null;
  owner_display_names: string | null;
  created_at: string;
}

export interface Session {
  user_id: string;
  email: string;
  name: string;
}

export interface Env {
  DB: D1Database;
  WORKER_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
}
