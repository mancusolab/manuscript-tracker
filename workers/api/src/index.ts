import type { Env } from '../../shared/types';
import {
  getSections, getAnnotations, getAllAnnotations, addressAnnotation,
  addProgressEntry, deleteProgressEntry, getProgressLog, getActivityFeed, updateSectionStatus,
  getSnapshots, upsertSnapshot, createAnnotation, getSyncState, setSyncState
} from '../../shared/db';
import { getAccessToken, fetchDocContent, fetchRevisions, postComment, resolveComment, getComments, watchFile, stopWatch } from '../../shared/google-auth';
import { parseDocument, getSnippet } from '../../shared/doc-parser';

// Owner identification — configured via OWNER_EMAILS and OWNER_DISPLAY_NAMES env vars
function parseList(csv: string): string[] {
  return csv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function isOwner(email: string, env: Env): boolean {
  return parseList(env.OWNER_EMAILS || env.OWNER_EMAIL).includes(email.toLowerCase());
}

function isOwnerComment(author: { emailAddress?: string; displayName?: string }, env: Env): boolean {
  if (author.emailAddress) return isOwner(author.emailAddress, env);
  if (author.displayName) return parseList(env.OWNER_DISPLAY_NAMES || '').includes(author.displayName.toLowerCase());
  return false;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function notFound() {
  return json({ error: 'Not found' }, 404);
}

// ---- Sync Logic ----

async function syncDocument(env: Env) {
  console.log('Starting sync...');

  const accessToken = await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const doc = await fetchDocContent(accessToken, env.GOOGLE_DOC_ID);
  const parsedSections = await parseDocument(doc);
  const revisions = await fetchRevisions(accessToken, env.GOOGLE_DOC_ID);
  const lastSyncedRevision = await getSyncState(env.DB, 'last_revision_id');

  let newRevisions = revisions;
  if (lastSyncedRevision) {
    const lastIdx = revisions.findIndex((r: any) => r.id === lastSyncedRevision);
    if (lastIdx >= 0) {
      newRevisions = revisions.slice(lastIdx + 1);
    }
  }

  const latestAdvisorRevision = newRevisions
    .filter((r: any) => {
      const email = r.lastModifyingUser?.emailAddress || '';
      return email && !isOwner(email, env);
    })
    .pop();

  const latestOwnerRevision = newRevisions
    .filter((r: any) => {
      const email = r.lastModifyingUser?.emailAddress || '';
      return isOwner(email, env);
    })
    .pop();

  for (const section of parsedSections) {
    const storedSnapshots = await getSnapshots(env.DB, section.id);
    const storedMap = new Map(storedSnapshots.map(s => [s.paragraph_index, s]));

    for (const para of section.paragraphs) {
      const stored = storedMap.get(para.index);

      if (!stored) {
        if (latestAdvisorRevision) {
          const advisor = latestAdvisorRevision.lastModifyingUser;
          const commentContent = `${advisor.displayName} added this on ${new Date(latestAdvisorRevision.modifiedTime).toLocaleString()} — Needs Review`;

          let commentId: string | undefined;
          try {
            commentId = await postComment(accessToken, env.GOOGLE_DOC_ID, commentContent);
          } catch (e) {
            console.error('Failed to post comment:', e);
          }

          await createAnnotation(env.DB, {
            section_id: section.id,
            paragraph_index: para.index,
            paragraph_snippet: getSnippet(para.text),
            author_email: advisor.emailAddress,
            author_name: advisor.displayName,
            change_type: 'added',
            google_comment_id: commentId,
          });

          await updateSectionStatus(env.DB, section.id, 'edited', advisor.emailAddress);
        }
      } else if (stored.content_hash !== para.hash) {
        if (latestAdvisorRevision) {
          const advisor = latestAdvisorRevision.lastModifyingUser;
          const commentContent = `${advisor.displayName} edited this on ${new Date(latestAdvisorRevision.modifiedTime).toLocaleString()} — Needs Review`;

          let commentId: string | undefined;
          try {
            commentId = await postComment(accessToken, env.GOOGLE_DOC_ID, commentContent);
          } catch (e) {
            console.error('Failed to post comment:', e);
          }

          await createAnnotation(env.DB, {
            section_id: section.id,
            paragraph_index: para.index,
            paragraph_snippet: getSnippet(para.text),
            author_email: advisor.emailAddress,
            author_name: advisor.displayName,
            change_type: 'modified',
            google_comment_id: commentId,
          });

          await updateSectionStatus(env.DB, section.id, 'edited', advisor.emailAddress);
        } else if (latestOwnerRevision) {
          const pendingAnnotations = await env.DB.prepare(
            `SELECT id, google_comment_id FROM annotations
             WHERE section_id = ? AND paragraph_index = ? AND status = 'needs_review'`
          ).bind(section.id, para.index).all();

          for (const ann of pendingAnnotations.results as any[]) {
            await env.DB.prepare(
              `UPDATE annotations SET status = 'addressed', addressed_by = ?, addressed_at = ?, addressed_note = 'Auto-resolved: owner edited this paragraph'
               WHERE id = ?`
            ).bind(env.OWNER_EMAIL, new Date().toISOString(), ann.id).run();

            if (ann.google_comment_id) {
              try {
                await resolveComment(accessToken, env.GOOGLE_DOC_ID, ann.google_comment_id);
              } catch (e) {
                console.error('Failed to resolve comment:', e);
              }
            }
          }
        }
      }

      await upsertSnapshot(env.DB, {
        section_id: section.id,
        paragraph_index: para.index,
        content_hash: para.hash,
        content_text: para.text,
      });
    }
  }

  // 5. Track advisor comments and handle resolved comments
  try {
    const comments = await getComments(accessToken, env.GOOGLE_DOC_ID);
    const trackedCommentIds = await env.DB.prepare(
      `SELECT google_comment_id FROM annotations WHERE google_comment_id IS NOT NULL`
    ).all();
    const trackedIds = new Set((trackedCommentIds.results as any[]).map(r => r.google_comment_id));

    // Only track comments created after the system was first set up
    // On first run, set cutoff to NOW so only future comments are tracked
    let firstSyncAt = await getSyncState(env.DB, 'first_sync_at');
    if (!firstSyncAt) {
      firstSyncAt = new Date().toISOString();
      await setSyncState(env.DB, 'first_sync_at', firstSyncAt);
    }
    const cutoffDate = new Date(firstSyncAt);

    // Helper to strip HTML entities from quoted text
    function stripHtml(html: string): string {
      return html
        .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]*>/g, '')
        .trim();
    }

    // Helper to match quoted text to a section
    function findSection(quotedHtml: string): { sectionId: string; paraIndex: number } {
      const cleaned = stripHtml(quotedHtml);
      if (!cleaned) return { sectionId: 'introduction', paraIndex: 0 };

      // Try to find which section paragraph contains the quoted text
      const searchText = cleaned.slice(0, 50).toLowerCase();
      for (const section of parsedSections) {
        for (const para of section.paragraphs) {
          const paraLower = para.text.toLowerCase();
          if (paraLower.includes(searchText) || searchText.includes(paraLower.slice(0, 30))) {
            return { sectionId: section.id, paraIndex: para.index };
          }
        }
      }
      return { sectionId: 'introduction', paraIndex: 0 };
    }

    for (const comment of comments) {
      const authorEmail = comment.author?.emailAddress || '';
      const authorName = comment.author?.displayName || 'Unknown';
      const commentAuthor = comment.author || {};
      const createdTime = new Date(comment.createdTime || 0);

      // Only track new, unresolved, non-owner comments created after setup
      if (!trackedIds.has(comment.id) && !comment.resolved && !isOwnerComment(commentAuthor, env) && createdTime > cutoffDate) {
        const quotedHtml = comment.quotedFileContent?.value || '';
        const cleanQuoted = stripHtml(quotedHtml);
        const snippet = cleanQuoted.length > 60 ? cleanQuoted.slice(0, 60) + '...' : cleanQuoted;
        const { sectionId, paraIndex } = findSection(quotedHtml);

        await createAnnotation(env.DB, {
          section_id: sectionId,
          paragraph_index: paraIndex,
          paragraph_snippet: snippet || 'Comment',
          author_email: authorEmail || authorName,
          author_name: authorName,
          change_type: 'commented',
          google_comment_id: comment.id,
          comment_text: comment.content || '',
        });

        await updateSectionStatus(env.DB, sectionId, 'edited', authorEmail || authorName);
      }

      // Handle resolved comments
      if (comment.resolved && trackedIds.has(comment.id)) {
        await env.DB.prepare(
          `UPDATE annotations SET status = 'addressed', addressed_by = ?, addressed_at = ?, addressed_note = 'Resolved via Google Doc comment'
           WHERE google_comment_id = ? AND status = 'needs_review'`
        ).bind(env.OWNER_EMAIL, new Date().toISOString(), comment.id).run();
      }
    }
  } catch (e) {
    console.error('Failed to check comments:', e);
  }

  if (revisions.length > 0) {
    await setSyncState(env.DB, 'last_revision_id', revisions[revisions.length - 1].id);
  }
  await setSyncState(env.DB, 'last_sync_at', new Date().toISOString());

  console.log('Sync complete');
}

// ---- Watch Renewal ----

async function renewWatch(env: Env) {
  const webhookUrl = env.WORKER_URL + '/webhook';

  try {
    // Stop existing watch if any
    const existingChannelId = await getSyncState(env.DB, 'watch_channel_id');
    const existingResourceId = await getSyncState(env.DB, 'watch_resource_id');
    if (existingChannelId && existingResourceId) {
      const accessToken = await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT_KEY);
      await stopWatch(accessToken, existingChannelId, existingResourceId).catch(() => {});
    }

    // Create new watch
    const channelId = `manuscript-tracker-${Date.now()}`;
    const accessToken = await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const result = await watchFile(accessToken, env.GOOGLE_DOC_ID, webhookUrl, channelId);

    await setSyncState(env.DB, 'watch_channel_id', channelId);
    await setSyncState(env.DB, 'watch_resource_id', result.resourceId || '');
    await setSyncState(env.DB, 'watch_expiration', result.expiration || '');

    console.log('Watch renewed, channel:', channelId);
  } catch (e) {
    console.error('Failed to renew watch:', e);
    // Fall back to sync on cron if watch fails
    await syncDocument(env);
  }
}

// ---- Worker Export ----

export default {
  // Cron trigger — renew Google Drive watch daily + fallback sync
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(renewWatch(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Google Drive webhook push notification
    if (path === '/webhook' && request.method === 'POST') {
      const channelId = request.headers.get('x-goog-channel-id');
      const state = request.headers.get('x-goog-resource-state');

      // Ignore the initial 'sync' message from watch setup
      if (state === 'sync') {
        return new Response('OK', { status: 200 });
      }

      // File was changed — run sync
      if (state === 'update' || state === 'change') {
        try {
          await syncDocument(env);
        } catch (e) {
          console.error('Webhook sync failed:', e);
        }
      }

      return new Response('OK', { status: 200 });
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // POST /sync — manual sync trigger
    if (path === '/sync' && request.method === 'POST') {
      try {
        await syncDocument(env);
        return json({ success: true, synced_at: new Date().toISOString() });
      } catch (e: any) {
        return json({ error: e.message }, 500);
      }
    }

    // POST /watch — manually register/renew the Google Drive watch
    if (path === '/watch' && request.method === 'POST') {
      try {
        await renewWatch(env);
        return json({ success: true, message: 'Watch registered' });
      } catch (e: any) {
        return json({ error: e.message }, 500);
      }
    }

    // GET /api/sections
    if (path === '/api/sections' && request.method === 'GET') {
      const sections = await getSections(env.DB);
      return json(sections);
    }

    // GET /api/sections/:id/annotations
    const annotationMatch = path.match(/^\/api\/sections\/([^/]+)\/annotations$/);
    if (annotationMatch && request.method === 'GET') {
      const sectionId = annotationMatch[1];
      const annotations = await getAnnotations(env.DB, sectionId);
      return json(annotations);
    }

    // PATCH /api/annotations/:id/address
    const addressMatch = path.match(/^\/api\/annotations\/(\d+)\/address$/);
    if (addressMatch && request.method === 'PATCH') {
      const annotationId = parseInt(addressMatch[1]);
      const body = await request.json() as { addressed_by: string; note?: string };
      await addressAnnotation(env.DB, annotationId, body.addressed_by, body.note);
      return json({ success: true });
    }

    // POST /api/sections/:id/status
    const statusMatch = path.match(/^\/api\/sections\/([^/]+)\/status$/);
    if (statusMatch && request.method === 'POST') {
      const sectionId = statusMatch[1];
      const body = await request.json() as { status: string };
      await updateSectionStatus(env.DB, sectionId, body.status);
      return json({ success: true });
    }

    // GET /api/progress
    if (path === '/api/progress' && request.method === 'GET') {
      const sectionId = url.searchParams.get('section_id') || undefined;
      const log = await getProgressLog(env.DB, sectionId);
      return json(log);
    }

    // POST /api/progress
    if (path === '/api/progress' && request.method === 'POST') {
      const body = await request.json() as {
        section_id: string;
        status: string;
        note: string;
        logged_by: string;
      };
      await addProgressEntry(env.DB, body);
      return json({ success: true });
    }

    // DELETE /api/progress/:id
    const deleteProgressMatch = path.match(/^\/api\/progress\/(\d+)$/);
    if (deleteProgressMatch && request.method === 'DELETE') {
      const progressId = parseInt(deleteProgressMatch[1]);
      await deleteProgressEntry(env.DB, progressId);
      return json({ success: true });
    }

    // GET /api/activity
    if (path === '/api/activity' && request.method === 'GET') {
      const feed = await getActivityFeed(env.DB);
      return json(feed);
    }

    // GET /api/annotations
    if (path === '/api/annotations' && request.method === 'GET') {
      const annotations = await getAllAnnotations(env.DB);
      return json(annotations);
    }

    return notFound();
  },
};
