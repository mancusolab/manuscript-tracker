import type { Env, ParagraphSnapshot } from '../../shared/types';
import { getAccessToken, fetchDocContent, fetchRevisions, postComment, resolveComment, getComments } from '../../shared/google-auth';
import { parseDocument, getSnippet } from '../../shared/doc-parser';
import { getSnapshots, upsertSnapshot, createAnnotation, getSyncState, setSyncState, updateSectionStatus, getSections } from '../../shared/db';

// Both owner emails — edits from these are treated as "yours", not advisor edits
const OWNER_EMAILS = ['crui@usc.edu', 'xrui0419@gmail.com'];

function isOwner(email: string): boolean {
  return OWNER_EMAILS.includes(email.toLowerCase());
}

export default {
  // Cron trigger — runs every 15 minutes
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncDocument(env));
  },

  // Also allow manual trigger via HTTP
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/sync' && request.method === 'POST') {
      await syncDocument(env);
      return new Response(JSON.stringify({ success: true, synced_at: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }
    return new Response('Not found', { status: 404 });
  },
};

async function syncDocument(env: Env) {
  console.log('Starting sync...');

  // 1. Authenticate with Google
  const accessToken = await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT_KEY);

  // 2. Fetch current document content and parse sections
  const doc = await fetchDocContent(accessToken, env.GOOGLE_DOC_ID);
  const parsedSections = await parseDocument(doc);

  // 3. Fetch revisions to identify who made changes
  const revisions = await fetchRevisions(accessToken, env.GOOGLE_DOC_ID);
  const lastSyncedRevision = await getSyncState(env.DB, 'last_revision_id');

  // Find new revisions since last sync
  let newRevisions = revisions;
  if (lastSyncedRevision) {
    const lastIdx = revisions.findIndex((r: any) => r.id === lastSyncedRevision);
    if (lastIdx >= 0) {
      newRevisions = revisions.slice(lastIdx + 1);
    }
  }

  // Determine the most recent non-owner editor (advisor)
  const latestAdvisorRevision = newRevisions
    .filter((r: any) => {
      const email = r.lastModifyingUser?.emailAddress || '';
      return email && !isOwner(email);
    })
    .pop();

  const latestOwnerRevision = newRevisions
    .filter((r: any) => {
      const email = r.lastModifyingUser?.emailAddress || '';
      return isOwner(email);
    })
    .pop();

  // 4. Diff paragraphs against stored snapshots
  for (const section of parsedSections) {
    const storedSnapshots = await getSnapshots(env.DB, section.id);
    const storedMap = new Map(storedSnapshots.map(s => [s.paragraph_index, s]));

    for (const para of section.paragraphs) {
      const stored = storedMap.get(para.index);

      if (!stored) {
        // New paragraph — if there are new advisor revisions, attribute to advisor
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
        // Paragraph modified — determine who changed it
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
          // Owner edited — check if this addresses any existing annotations
          // Auto-resolve is handled by checking if owner edited a paragraph with pending annotations
          const db = env.DB;
          const pendingAnnotations = await db.prepare(
            `SELECT id, google_comment_id FROM annotations
             WHERE section_id = ? AND paragraph_index = ? AND status = 'needs_review'`
          ).bind(section.id, para.index).all();

          for (const ann of pendingAnnotations.results as any[]) {
            await db.prepare(
              `UPDATE annotations SET status = 'addressed', addressed_by = ?, addressed_at = ?, addressed_note = 'Auto-resolved: owner edited this paragraph'
               WHERE id = ?`
            ).bind(env.OWNER_EMAIL, new Date().toISOString(), ann.id).run();

            // Resolve the Google Doc comment
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

      // Update snapshot
      await upsertSnapshot(env.DB, {
        section_id: section.id,
        paragraph_index: para.index,
        content_hash: para.hash,
        content_text: para.text,
      });
    }
  }

  // 5. Check for externally resolved comments
  try {
    const comments = await getComments(accessToken, env.GOOGLE_DOC_ID);
    const resolvedComments = comments.filter((c: any) => c.resolved);
    for (const comment of resolvedComments) {
      await env.DB.prepare(
        `UPDATE annotations SET status = 'addressed', addressed_by = ?, addressed_at = ?, addressed_note = 'Resolved via Google Doc comment'
         WHERE google_comment_id = ? AND status = 'needs_review'`
      ).bind(env.OWNER_EMAIL, new Date().toISOString(), comment.id).run();
    }
  } catch (e) {
    console.error('Failed to check comments:', e);
  }

  // 6. Update last synced revision
  if (revisions.length > 0) {
    await setSyncState(env.DB, 'last_revision_id', revisions[revisions.length - 1].id);
  }
  await setSyncState(env.DB, 'last_sync_at', new Date().toISOString());

  console.log('Sync complete');
}
