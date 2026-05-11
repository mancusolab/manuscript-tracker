/**
 * Per-user sync logic — extracted from the old single-tenant syncDocument/renewWatch
 * into multi-tenant functions that operate on a single user at a time.
 */

import type { Env, User } from './types';
import {
  getUser,
  getAllActiveUsers,
  getSnapshots,
  upsertSnapshot,
  createAnnotation,
  updateSectionStatus,
  getSyncState,
  setSyncState,
} from './db';
import { getUserAccessToken } from './auth';
import { fetchDocContent, fetchRevisions, postComment, resolveComment, getComments, watchFile, stopWatch } from './google-auth';
import { parseDocument, getSnippet } from './doc-parser';

// ── Helpers ──────────────────────────────────────────────────────────

function parseList(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function isOwnerEmail(email: string, user: User): boolean {
  const ownerEmails = [user.email.toLowerCase(), ...parseList(user.owner_emails)];
  return ownerEmails.includes(email.toLowerCase());
}

function isOwnerAuthor(
  author: { emailAddress?: string; displayName?: string },
  user: User,
): boolean {
  if (author.emailAddress) return isOwnerEmail(author.emailAddress, user);
  if (author.displayName) {
    return parseList(user.owner_display_names).includes(author.displayName.toLowerCase());
  }
  return false;
}

function stripHtml(html: string): string {
  return html
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]*>/g, '')
    .trim();
}

// ── syncUserDocument ─────────────────────────────────────────────────

export async function syncUserDocument(env: Env, userId: string): Promise<void> {
  const user = await getUser(env.DB, userId);
  if (!user || !user.google_doc_id) return;

  let accessToken: string;
  try {
    accessToken = await getUserAccessToken(userId, env);
  } catch {
    // getUserAccessToken already marks user as needs_reauth on failure
    console.error(`[sync] Token expired for user ${userId}, skipping`);
    return;
  }

  const docId = user.google_doc_id;

  const doc = await fetchDocContent(accessToken, docId);
  const parsedSections = await parseDocument(doc);
  const revisions = await fetchRevisions(accessToken, docId);
  const lastSyncedRevision = await getSyncState(env.DB, 'last_revision_id', userId);

  // Determine new revisions since last sync
  let newRevisions = revisions;
  if (lastSyncedRevision) {
    const lastIdx = revisions.findIndex((r: any) => r.id === lastSyncedRevision);
    if (lastIdx >= 0) {
      newRevisions = revisions.slice(lastIdx + 1);
    }
  }

  // Find latest non-owner (advisor) and owner revisions among new ones
  const latestAdvisorRevision = newRevisions
    .filter((r: any) => {
      const email = r.lastModifyingUser?.emailAddress || '';
      return email && !isOwnerEmail(email, user);
    })
    .pop();

  const latestOwnerRevision = newRevisions
    .filter((r: any) => {
      const email = r.lastModifyingUser?.emailAddress || '';
      return isOwnerEmail(email, user);
    })
    .pop();

  // Diff paragraphs against stored snapshots
  for (const section of parsedSections) {
    const storedSnapshots = await getSnapshots(env.DB, section.id, userId);
    const storedMap = new Map(storedSnapshots.map(s => [s.paragraph_index, s]));

    for (const para of section.paragraphs) {
      const stored = storedMap.get(para.index);

      if (!stored) {
        // New paragraph — attribute to advisor if available
        if (latestAdvisorRevision) {
          const advisor = latestAdvisorRevision.lastModifyingUser;
          const commentContent = `${advisor.displayName} added this on ${new Date(latestAdvisorRevision.modifiedTime).toLocaleString()} — Needs Review`;

          let commentId: string | undefined;
          try {
            commentId = await postComment(accessToken, docId, commentContent);
          } catch (e) {
            console.error('[sync] Failed to post comment:', e);
          }

          await createAnnotation(env.DB, {
            section_id: section.id,
            paragraph_index: para.index,
            paragraph_snippet: getSnippet(para.text),
            author_email: advisor.emailAddress,
            author_name: advisor.displayName,
            change_type: 'added',
            google_comment_id: commentId,
            user_id: userId,
          });

          await updateSectionStatus(env.DB, section.id, 'edited', advisor.emailAddress, userId);
        }
      } else if (stored.content_hash !== para.hash) {
        // Paragraph changed
        if (latestAdvisorRevision) {
          const advisor = latestAdvisorRevision.lastModifyingUser;
          const commentContent = `${advisor.displayName} edited this on ${new Date(latestAdvisorRevision.modifiedTime).toLocaleString()} — Needs Review`;

          let commentId: string | undefined;
          try {
            commentId = await postComment(accessToken, docId, commentContent);
          } catch (e) {
            console.error('[sync] Failed to post comment:', e);
          }

          await createAnnotation(env.DB, {
            section_id: section.id,
            paragraph_index: para.index,
            paragraph_snippet: getSnippet(para.text),
            author_email: advisor.emailAddress,
            author_name: advisor.displayName,
            change_type: 'modified',
            google_comment_id: commentId,
            user_id: userId,
          });

          await updateSectionStatus(env.DB, section.id, 'edited', advisor.emailAddress, userId);
        } else if (latestOwnerRevision) {
          // Owner edited — auto-resolve pending annotations on this paragraph
          const pendingAnnotations = await env.DB.prepare(
            `SELECT id, google_comment_id FROM annotations
             WHERE section_id = ? AND paragraph_index = ? AND status = 'needs_review' AND user_id = ?`
          ).bind(section.id, para.index, userId).all();

          for (const ann of pendingAnnotations.results as any[]) {
            await env.DB.prepare(
              `UPDATE annotations SET status = 'addressed', addressed_by = ?, addressed_at = ?, addressed_note = 'Auto-resolved: owner edited this paragraph'
               WHERE id = ? AND user_id = ?`
            ).bind(user.email, new Date().toISOString(), ann.id, userId).run();

            if (ann.google_comment_id) {
              try {
                await resolveComment(accessToken, docId, ann.google_comment_id);
              } catch (e) {
                console.error('[sync] Failed to resolve comment:', e);
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
        user_id: userId,
      });
    }
  }

  // Track advisor comments and handle resolved comments
  try {
    const comments = await getComments(accessToken, docId);
    const trackedCommentIds = await env.DB.prepare(
      `SELECT google_comment_id FROM annotations WHERE google_comment_id IS NOT NULL AND user_id = ?`
    ).bind(userId).all();
    const trackedIds = new Set((trackedCommentIds.results as any[]).map(r => r.google_comment_id));

    // Only track comments created after the system was first set up for this user
    let firstSyncAt = await getSyncState(env.DB, 'first_sync_at', userId);
    if (!firstSyncAt) {
      firstSyncAt = new Date().toISOString();
      await setSyncState(env.DB, 'first_sync_at', firstSyncAt, userId);
    }
    const cutoffDate = new Date(firstSyncAt);

    // Helper to match quoted text to a section
    function findSection(quotedHtml: string): { sectionId: string; paraIndex: number } {
      const cleaned = stripHtml(quotedHtml);
      if (!cleaned) return { sectionId: 'introduction', paraIndex: 0 };

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
      if (
        !trackedIds.has(comment.id) &&
        !comment.resolved &&
        !isOwnerAuthor(commentAuthor, user) &&
        createdTime > cutoffDate
      ) {
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
          user_id: userId,
        });

        await updateSectionStatus(env.DB, sectionId, 'edited', authorEmail || authorName, userId);
      }

      // Handle resolved comments — auto-address matching annotations
      if (comment.resolved && trackedIds.has(comment.id)) {
        await env.DB.prepare(
          `UPDATE annotations SET status = 'addressed', addressed_by = ?, addressed_at = ?, addressed_note = 'Resolved via Google Doc comment'
           WHERE google_comment_id = ? AND status = 'needs_review' AND user_id = ?`
        ).bind(user.email, new Date().toISOString(), comment.id, userId).run();
      }
    }
  } catch (e) {
    console.error('[sync] Failed to check comments:', e);
  }

  // Update sync state
  if (revisions.length > 0) {
    await setSyncState(env.DB, 'last_revision_id', revisions[revisions.length - 1].id, userId);
  }
  await setSyncState(env.DB, 'last_sync_at', new Date().toISOString(), userId);

  console.log(`[sync] Sync complete for user ${userId}`);
}

// ── renewUserWatch ───────────────────────────────────────────────────

export async function renewUserWatch(env: Env, userId: string): Promise<void> {
  const user = await getUser(env.DB, userId);
  if (!user || !user.google_doc_id) return;

  let accessToken: string;
  try {
    accessToken = await getUserAccessToken(userId, env);
  } catch {
    console.error(`[watch] Token expired for user ${userId}, skipping`);
    return;
  }

  const docId = user.google_doc_id;
  const webhookUrl = `${env.WORKER_URL}/webhook/${userId}`;

  // Stop existing watch if any
  const existingChannelId = await getSyncState(env.DB, 'watch_channel_id', userId);
  const existingResourceId = await getSyncState(env.DB, 'watch_resource_id', userId);
  if (existingChannelId && existingResourceId) {
    await stopWatch(accessToken, existingChannelId, existingResourceId).catch(() => {});
  }

  // Create new watch
  const channelId = `ms-tracker-${userId}-${Date.now()}`;
  const result = await watchFile(accessToken, docId, webhookUrl, channelId);

  await setSyncState(env.DB, 'watch_channel_id', channelId, userId);
  await setSyncState(env.DB, 'watch_resource_id', result.resourceId || '', userId);
  await setSyncState(env.DB, 'watch_expiration', result.expiration || '', userId);

  console.log(`[watch] Watch renewed for user ${userId}, channel: ${channelId}`);
}

// ── Batch operations ─────────────────────────────────────────────────

export async function syncAllUsers(env: Env): Promise<void> {
  const users = await getAllActiveUsers(env.DB);
  console.log(`[sync] Starting sync for ${users.length} active user(s)`);

  for (const user of users) {
    try {
      await syncUserDocument(env, user.id);
    } catch (e) {
      console.error(`[sync] Failed to sync user ${user.id}:`, e);
    }
  }
}

export async function renewAllWatches(env: Env): Promise<void> {
  const users = await getAllActiveUsers(env.DB);
  console.log(`[watch] Renewing watches for ${users.length} active user(s)`);

  for (const user of users) {
    try {
      await renewUserWatch(env, user.id);
    } catch (e) {
      console.error(`[watch] Failed to renew watch for user ${user.id}:`, e);
    }
  }
}
