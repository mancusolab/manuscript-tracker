import type { Env } from '../../shared/types';
import { getLoginUrl, handleCallback, getSession, requireSession } from '../../shared/auth';
import { syncUserDocument, renewUserWatch, renewAllWatches } from '../../shared/sync';
import {
  getUser, getUserBySlug, updateUser, seedSectionsForUser,
  getSections, getAnnotations, getAllAnnotations, addressAnnotation,
  updateSectionStatus,
  getProgressLog, addProgressEntry, deleteProgressEntry,
  getActivityFeed,
} from '../../shared/db';

// ── Helpers ──────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Worker Export ────────────────────────────────────────────────────

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(renewAllWatches(env));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // ── Auth routes ──────────────────────────────────────────────

      if (path === '/auth/login' && method === 'GET') {
        return Response.redirect(getLoginUrl(env));
      }

      if (path === '/auth/callback' && method === 'GET') {
        const code = url.searchParams.get('code');
        if (!code) return json({ error: 'Missing code parameter' }, 400);
        try {
          const { cookie, redirectUrl } = await handleCallback(code, env);
          return new Response(null, {
            status: 302,
            headers: {
              Location: redirectUrl,
              'Set-Cookie': cookie,
            },
          });
        } catch (callbackErr: any) {
          return json({ error: 'Callback failed', detail: callbackErr.message }, 500);
        }
      }

      if (path === '/auth/logout' && method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
          },
        });
      }

      if (path === '/auth/me' && method === 'GET') {
        const session = await getSession(request, env);
        if (!session) return json({ error: 'Unauthorized' }, 401);

        const user = await getUser(env.DB, session.user_id);
        if (!user) return json({ error: 'User not found' }, 404);

        return json({
          id: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture,
          google_doc_id: user.google_doc_id,
          token_status: user.token_status,
          share_slug: user.share_slug,
        });
      }

      // ── Webhook route ────────────────────────────────────────────

      const webhookMatch = path.match(/^\/webhook\/([^/]+)$/);
      if (webhookMatch && method === 'POST') {
        const userId = webhookMatch[1];
        const state = request.headers.get('x-goog-resource-state');

        if (state === 'sync') {
          return new Response('OK', { status: 200 });
        }

        if (state === 'update' || state === 'change') {
          ctx.waitUntil(syncUserDocument(env, userId));
        }

        return new Response('OK', { status: 200 });
      }

      // ── Share routes (read-only, no auth required) ────────────────

      const shareMatch = path.match(/^\/api\/share\/([^/]+)$/);
      if (shareMatch && method === 'GET') {
        const slug = shareMatch[1];
        const sharedUser = await getUserBySlug(env.DB, slug);
        if (!sharedUser || !sharedUser.google_doc_id) return json({ error: 'Not found' }, 404);

        const sections = await getSections(env.DB, sharedUser.id);
        const activity = await getActivityFeed(env.DB, sharedUser.id);

        return json({
          user: { name: sharedUser.name, picture: sharedUser.picture },
          sections,
          activity,
        });
      }

      const shareAnnotationsMatch = path.match(/^\/api\/share\/([^/]+)\/sections\/([^/]+)\/annotations$/);
      if (shareAnnotationsMatch && method === 'GET') {
        const slug = shareAnnotationsMatch[1];
        const sectionId = shareAnnotationsMatch[2];
        const sharedUser = await getUserBySlug(env.DB, slug);
        if (!sharedUser) return json({ error: 'Not found' }, 404);

        const annotations = await getAnnotations(env.DB, sectionId, sharedUser.id);
        const progress = await getProgressLog(env.DB, sectionId, sharedUser.id);
        return json({ annotations, progress });
      }

      // ── API routes (all require session) ─────────────────────────

      if (path.startsWith('/api/')) {
        const session = await requireSession(request, env);
        const db = env.DB;

        // POST /api/setup
        if (path === '/api/setup' && method === 'POST') {
          const body = (await request.json()) as { google_doc_url: string };
          const docMatch = body.google_doc_url.match(/\/d\/([a-zA-Z0-9_-]+)/);
          if (!docMatch) return json({ error: 'Invalid Google Doc URL' }, 400);
          const googleDocId = docMatch[1];

          await updateUser(db, session.user_id, { google_doc_id: googleDocId });
          await seedSectionsForUser(db, session.user_id);
          ctx.waitUntil(syncUserDocument(env, session.user_id));
          ctx.waitUntil(renewUserWatch(env, session.user_id));

          return json({ success: true, google_doc_id: googleDocId });
        }

        // GET /api/sections
        if (path === '/api/sections' && method === 'GET') {
          const sections = await getSections(db, session.user_id);
          return json(sections);
        }

        // GET /api/sections/:id/annotations
        const sectionAnnotationsMatch = path.match(/^\/api\/sections\/([^/]+)\/annotations$/);
        if (sectionAnnotationsMatch && method === 'GET') {
          const sectionId = sectionAnnotationsMatch[1];
          const annotations = await getAnnotations(db, sectionId, session.user_id);
          return json(annotations);
        }

        // PATCH /api/annotations/:id/address
        const addressMatch = path.match(/^\/api\/annotations\/(\d+)\/address$/);
        if (addressMatch && method === 'PATCH') {
          const annotationId = parseInt(addressMatch[1]);
          const body = (await request.json()) as { note?: string };
          await addressAnnotation(db, annotationId, session.email, body.note, session.user_id);
          return json({ success: true });
        }

        // POST /api/sections/:id/status
        const statusMatch = path.match(/^\/api\/sections\/([^/]+)\/status$/);
        if (statusMatch && method === 'POST') {
          const sectionId = statusMatch[1];
          const body = (await request.json()) as { status: string };
          await updateSectionStatus(db, sectionId, body.status, undefined, session.user_id);
          return json({ success: true });
        }

        // GET /api/progress
        if (path === '/api/progress' && method === 'GET') {
          const sectionId = url.searchParams.get('section_id') || undefined;
          const log = await getProgressLog(db, sectionId, session.user_id);
          return json(log);
        }

        // POST /api/progress
        if (path === '/api/progress' && method === 'POST') {
          const body = (await request.json()) as {
            section_id: string;
            status: string;
            note: string;
          };
          await addProgressEntry(db, {
            section_id: body.section_id,
            status: body.status,
            note: body.note,
            logged_by: session.email,
            user_id: session.user_id,
          });
          return json({ success: true });
        }

        // DELETE /api/progress/:id
        const deleteProgressMatch = path.match(/^\/api\/progress\/(\d+)$/);
        if (deleteProgressMatch && method === 'DELETE') {
          const progressId = parseInt(deleteProgressMatch[1]);
          await deleteProgressEntry(db, progressId, session.user_id);
          return json({ success: true });
        }

        // GET /api/activity
        if (path === '/api/activity' && method === 'GET') {
          const feed = await getActivityFeed(db, session.user_id);
          return json(feed);
        }

        // GET /api/annotations
        if (path === '/api/annotations' && method === 'GET') {
          const annotations = await getAllAnnotations(db, session.user_id);
          return json(annotations);
        }

        // POST /api/sync
        if (path === '/api/sync' && method === 'POST') {
          try {
            await syncUserDocument(env, session.user_id);
            return json({ success: true, synced_at: new Date().toISOString() });
          } catch (syncErr: any) {
            return json({ error: 'Sync failed', detail: syncErr.message }, 500);
          }
        }

        // PATCH /api/settings
        if (path === '/api/settings' && method === 'PATCH') {
          const body = (await request.json()) as Partial<{
            google_doc_id: string;
            owner_emails: string;
            owner_display_names: string;
          }>;
          await updateUser(db, session.user_id, body);
          return json({ success: true });
        }

        return json({ error: 'Not found' }, 404);
      }

      // ── Catch-all: serve static assets ─────────────────────────

      return env.ASSETS.fetch(request);
    } catch (err) {
      // requireSession throws a Response on 401
      if (err instanceof Response) return err;
      const message = err instanceof Error ? err.message : String(err);
      console.error('Unhandled error:', message);
      return json({ error: 'Internal server error', detail: message }, 500);
    }
  },
};
