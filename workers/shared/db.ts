import type { Env, Section, SectionWithStats, Annotation, ProgressEntry, ParagraphSnapshot, User } from './types';

// ── User functions ──────────────────────────────────────────────────

export async function createUser(db: D1Database, user: {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  refresh_token: string | null;
  token_status: string;
  created_at: string;
}) {
  await db.prepare(
    'INSERT INTO users (id, email, name, picture, refresh_token, token_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, user.email, user.name, user.picture, user.refresh_token, user.token_status, user.created_at).run();
}

export async function getUser(db: D1Database, userId: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<User>();
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
}

export async function updateUser(
  db: D1Database,
  userId: string,
  fields: Partial<{ google_doc_id: string; refresh_token: string; token_status: string; owner_emails: string; owner_display_names: string }>
) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const setClauses = entries.map(([k]) => `${k} = ?`).join(', ');
  const values = entries.map(([, v]) => v);
  await db.prepare(`UPDATE users SET ${setClauses} WHERE id = ?`).bind(...values, userId).run();
}

export async function getAllActiveUsers(db: D1Database): Promise<User[]> {
  const result = await db.prepare(
    "SELECT * FROM users WHERE token_status = 'active' AND google_doc_id IS NOT NULL"
  ).all<User>();
  return result.results;
}

export async function seedSectionsForUser(db: D1Database, userId: string) {
  const sections = [
    { id: 'abstract', name: 'Abstract', heading_pattern: 'abstract', sort_order: 0 },
    { id: 'introduction', name: 'Introduction', heading_pattern: 'introduction', sort_order: 1 },
    { id: 'materials-methods', name: 'Materials & Methods', heading_pattern: 'materials-methods', sort_order: 2 },
    { id: 'results', name: 'Results', heading_pattern: 'results', sort_order: 3 },
    { id: 'discussion', name: 'Discussion', heading_pattern: 'discussion', sort_order: 4 },
    { id: 'supplement', name: 'Supplement', heading_pattern: 'supplement', sort_order: 5 },
  ];
  const stmt = db.prepare(
    "INSERT INTO sections (id, name, heading_pattern, status, sort_order, user_id) VALUES (?, ?, ?, 'draft', ?, ?)"
  );
  await db.batch(
    sections.map(s => stmt.bind(s.id, s.name, s.heading_pattern, s.sort_order, userId))
  );
}

// ── Sections ────────────────────────────────────────────────────────

export async function getSections(db: D1Database, userId: string): Promise<SectionWithStats[]> {
  const result = await db.prepare(`
    SELECT s.*,
      COALESCE(SUM(CASE WHEN a.status = 'needs_review' THEN 1 ELSE 0 END), 0) as unresolved_count,
      COUNT(a.id) as total_annotations
    FROM sections s
    LEFT JOIN annotations a ON a.section_id = s.id AND a.user_id = s.user_id
    WHERE s.user_id = ?
    GROUP BY s.id
    ORDER BY s.sort_order
  `).bind(userId).all<SectionWithStats>();
  return result.results;
}

export async function getSection(db: D1Database, sectionId: string, userId: string): Promise<Section | null> {
  return db.prepare('SELECT * FROM sections WHERE id = ? AND user_id = ?').bind(sectionId, userId).first<Section>();
}

export async function updateSectionStatus(db: D1Database, sectionId: string, status: string, editedBy?: string, userId?: string) {
  const now = new Date().toISOString();
  if (editedBy) {
    await db.prepare('UPDATE sections SET status = ?, last_edited_by = ?, last_edited_at = ? WHERE id = ? AND user_id = ?')
      .bind(status, editedBy, now, sectionId, userId).run();
  } else {
    await db.prepare('UPDATE sections SET status = ? WHERE id = ? AND user_id = ?')
      .bind(status, sectionId, userId).run();
  }
}

// ── Annotations ─────────────────────────────────────────────────────

export async function getAnnotations(db: D1Database, sectionId: string, userId: string): Promise<Annotation[]> {
  const result = await db.prepare(
    'SELECT * FROM annotations WHERE section_id = ? AND user_id = ? ORDER BY paragraph_index, created_at DESC'
  ).bind(sectionId, userId).all<Annotation>();
  return result.results;
}

export async function getAllAnnotations(db: D1Database, userId: string): Promise<Annotation[]> {
  const result = await db.prepare(
    'SELECT * FROM annotations WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(userId).all<Annotation>();
  return result.results;
}

export async function createAnnotation(db: D1Database, annotation: {
  section_id: string;
  paragraph_index: number;
  paragraph_snippet: string;
  author_email: string;
  author_name: string;
  change_type: string;
  google_comment_id?: string;
  comment_text?: string;
  user_id: string;
}) {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO annotations (section_id, paragraph_index, paragraph_snippet, author_email, author_name, change_type, google_comment_id, comment_text, status, created_at, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'needs_review', ?, ?)
  `).bind(
    annotation.section_id,
    annotation.paragraph_index,
    annotation.paragraph_snippet,
    annotation.author_email,
    annotation.author_name,
    annotation.change_type,
    annotation.google_comment_id || null,
    annotation.comment_text || null,
    now,
    annotation.user_id
  ).run();
}

export async function addressAnnotation(db: D1Database, annotationId: number, addressedBy: string, note?: string, userId?: string) {
  const now = new Date().toISOString();
  await db.prepare(
    'UPDATE annotations SET status = ?, addressed_by = ?, addressed_at = ?, addressed_note = ? WHERE id = ? AND user_id = ?'
  ).bind('addressed', addressedBy, now, note || null, annotationId, userId).run();
}

// ── Progress Log ────────────────────────────────────────────────────

export async function getProgressLog(db: D1Database, sectionId?: string, userId?: string): Promise<ProgressEntry[]> {
  if (sectionId) {
    const result = await db.prepare(
      'SELECT * FROM progress_log WHERE section_id = ? AND user_id = ? ORDER BY timestamp DESC'
    ).bind(sectionId, userId).all<ProgressEntry>();
    return result.results;
  }
  const result = await db.prepare(
    'SELECT * FROM progress_log WHERE user_id = ? ORDER BY timestamp DESC LIMIT 50'
  ).bind(userId).all<ProgressEntry>();
  return result.results;
}

export async function addProgressEntry(db: D1Database, entry: {
  section_id: string;
  status: string;
  note: string;
  logged_by: string;
  user_id: string;
}) {
  const now = new Date().toISOString();
  await db.prepare(
    'INSERT INTO progress_log (section_id, status, note, logged_by, timestamp, user_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(entry.section_id, entry.status, entry.note, entry.logged_by, now, entry.user_id).run();
  await updateSectionStatus(db, entry.section_id, entry.status, undefined, entry.user_id);
}

export async function deleteProgressEntry(db: D1Database, id: number, userId: string) {
  await db.prepare('DELETE FROM progress_log WHERE id = ? AND user_id = ?').bind(id, userId).run();
}

// ── Snapshots ───────────────────────────────────────────────────────

export async function getSnapshots(db: D1Database, sectionId: string, userId: string): Promise<ParagraphSnapshot[]> {
  const result = await db.prepare(
    'SELECT section_id, paragraph_index, content_hash, content_text FROM paragraph_snapshots WHERE section_id = ? AND user_id = ? ORDER BY paragraph_index'
  ).bind(sectionId, userId).all<ParagraphSnapshot>();
  return result.results;
}

export async function upsertSnapshot(db: D1Database, snapshot: ParagraphSnapshot & { user_id: string }) {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO paragraph_snapshots (section_id, paragraph_index, content_hash, content_text, updated_at, user_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(section_id, paragraph_index, user_id) DO UPDATE SET content_hash = ?, content_text = ?, updated_at = ?
  `).bind(
    snapshot.section_id, snapshot.paragraph_index, snapshot.content_hash, snapshot.content_text, now, snapshot.user_id,
    snapshot.content_hash, snapshot.content_text, now
  ).run();
}

// ── Sync State ──────────────────────────────────────────────────────

export async function getSyncState(db: D1Database, key: string, userId: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM sync_state WHERE key = ? AND user_id = ?').bind(key, userId).first<{ value: string }>();
  return row?.value || null;
}

export async function setSyncState(db: D1Database, key: string, value: string, userId: string) {
  await db.prepare(
    'INSERT INTO sync_state (key, value, user_id) VALUES (?, ?, ?) ON CONFLICT(key, user_id) DO UPDATE SET value = ?'
  ).bind(key, value, userId, value).run();
}

// ── Activity Feed ───────────────────────────────────────────────────

export async function getActivityFeed(db: D1Database, userId: string): Promise<Array<{
  type: string;
  section_id: string;
  section_name: string;
  author: string;
  detail: string;
  timestamp: string;
}>> {
  const annotations = await db.prepare(`
    SELECT 'annotation' as type, a.section_id, s.name as section_name,
      a.author_name as author,
      CASE WHEN a.status = 'addressed'
        THEN a.addressed_by || ' addressed annotation on ¶' || (a.paragraph_index + 1)
        ELSE a.author_name || ' edited ¶' || (a.paragraph_index + 1) || ' — Needs Review'
      END as detail,
      COALESCE(a.addressed_at, a.created_at) as timestamp
    FROM annotations a JOIN sections s ON s.id = a.section_id AND s.user_id = a.user_id
    WHERE a.user_id = ?
    ORDER BY COALESCE(a.addressed_at, a.created_at) DESC LIMIT 30
  `).bind(userId).all();

  const progress = await db.prepare(`
    SELECT 'progress' as type, p.section_id, s.name as section_name,
      p.logged_by as author, p.note as detail, p.timestamp
    FROM progress_log p JOIN sections s ON s.id = p.section_id AND s.user_id = p.user_id
    WHERE p.user_id = ?
    ORDER BY p.timestamp DESC LIMIT 20
  `).bind(userId).all();

  const combined = [...(annotations.results as any[]), ...(progress.results as any[])];
  combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return combined.slice(0, 30);
}
