import type { Env, Section, SectionWithStats, Annotation, ProgressEntry, ParagraphSnapshot } from './types';

export async function getSections(db: D1Database): Promise<SectionWithStats[]> {
  const result = await db.prepare(`
    SELECT s.*,
      COALESCE(SUM(CASE WHEN a.status = 'needs_review' THEN 1 ELSE 0 END), 0) as unresolved_count,
      COUNT(a.id) as total_annotations
    FROM sections s
    LEFT JOIN annotations a ON a.section_id = s.id
    GROUP BY s.id
    ORDER BY s.sort_order
  `).all<SectionWithStats>();
  return result.results;
}

export async function getSection(db: D1Database, sectionId: string): Promise<Section | null> {
  return db.prepare('SELECT * FROM sections WHERE id = ?').bind(sectionId).first<Section>();
}

export async function updateSectionStatus(db: D1Database, sectionId: string, status: string, editedBy?: string) {
  const now = new Date().toISOString();
  if (editedBy) {
    await db.prepare('UPDATE sections SET status = ?, last_edited_by = ?, last_edited_at = ? WHERE id = ?')
      .bind(status, editedBy, now, sectionId).run();
  } else {
    await db.prepare('UPDATE sections SET status = ? WHERE id = ?')
      .bind(status, sectionId).run();
  }
}

export async function getAnnotations(db: D1Database, sectionId: string): Promise<Annotation[]> {
  const result = await db.prepare(
    'SELECT * FROM annotations WHERE section_id = ? ORDER BY paragraph_index, created_at DESC'
  ).bind(sectionId).all<Annotation>();
  return result.results;
}

export async function getAllAnnotations(db: D1Database): Promise<Annotation[]> {
  const result = await db.prepare(
    'SELECT * FROM annotations ORDER BY created_at DESC LIMIT 100'
  ).all<Annotation>();
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
}) {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO annotations (section_id, paragraph_index, paragraph_snippet, author_email, author_name, change_type, google_comment_id, comment_text, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'needs_review', ?)
  `).bind(
    annotation.section_id,
    annotation.paragraph_index,
    annotation.paragraph_snippet,
    annotation.author_email,
    annotation.author_name,
    annotation.change_type,
    annotation.google_comment_id || null,
    annotation.comment_text || null,
    now
  ).run();
}

export async function addressAnnotation(db: D1Database, annotationId: number, addressedBy: string, note?: string) {
  const now = new Date().toISOString();
  await db.prepare(
    'UPDATE annotations SET status = ?, addressed_by = ?, addressed_at = ?, addressed_note = ? WHERE id = ?'
  ).bind('addressed', addressedBy, now, note || null, annotationId).run();
}

export async function getProgressLog(db: D1Database, sectionId?: string): Promise<ProgressEntry[]> {
  if (sectionId) {
    const result = await db.prepare(
      'SELECT * FROM progress_log WHERE section_id = ? ORDER BY timestamp DESC'
    ).bind(sectionId).all<ProgressEntry>();
    return result.results;
  }
  const result = await db.prepare(
    'SELECT * FROM progress_log ORDER BY timestamp DESC LIMIT 50'
  ).all<ProgressEntry>();
  return result.results;
}

export async function addProgressEntry(db: D1Database, entry: {
  section_id: string;
  status: string;
  note: string;
  logged_by: string;
}) {
  const now = new Date().toISOString();
  await db.prepare(
    'INSERT INTO progress_log (section_id, status, note, logged_by, timestamp) VALUES (?, ?, ?, ?, ?)'
  ).bind(entry.section_id, entry.status, entry.note, entry.logged_by, now).run();
  await updateSectionStatus(db, entry.section_id, entry.status);
}

export async function deleteProgressEntry(db: D1Database, id: number) {
  await db.prepare('DELETE FROM progress_log WHERE id = ?').bind(id).run();
}

export async function getSnapshots(db: D1Database, sectionId: string): Promise<ParagraphSnapshot[]> {
  const result = await db.prepare(
    'SELECT section_id, paragraph_index, content_hash, content_text FROM paragraph_snapshots WHERE section_id = ? ORDER BY paragraph_index'
  ).bind(sectionId).all<ParagraphSnapshot>();
  return result.results;
}

export async function upsertSnapshot(db: D1Database, snapshot: ParagraphSnapshot) {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO paragraph_snapshots (section_id, paragraph_index, content_hash, content_text, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(section_id, paragraph_index) DO UPDATE SET content_hash = ?, content_text = ?, updated_at = ?
  `).bind(
    snapshot.section_id, snapshot.paragraph_index, snapshot.content_hash, snapshot.content_text, now,
    snapshot.content_hash, snapshot.content_text, now
  ).run();
}

export async function getSyncState(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM sync_state WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value || null;
}

export async function setSyncState(db: D1Database, key: string, value: string) {
  await db.prepare(
    'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  ).bind(key, value, value).run();
}

export async function getActivityFeed(db: D1Database): Promise<Array<{
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
    FROM annotations a JOIN sections s ON s.id = a.section_id
    ORDER BY COALESCE(a.addressed_at, a.created_at) DESC LIMIT 30
  `).all();

  const progress = await db.prepare(`
    SELECT 'progress' as type, p.section_id, s.name as section_name,
      p.logged_by as author, p.note as detail, p.timestamp
    FROM progress_log p JOIN sections s ON s.id = p.section_id
    ORDER BY p.timestamp DESC LIMIT 20
  `).all();

  const combined = [...(annotations.results as any[]), ...(progress.results as any[])];
  combined.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return combined.slice(0, 30);
}
