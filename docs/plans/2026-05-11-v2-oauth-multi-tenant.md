# V2: Multi-Tenant Web App with Google OAuth — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor manuscript-tracker from a self-hosted single-user tool to a multi-tenant web app where users sign in with Google, paste their Doc URL, and start tracking — zero setup on their end.

**Architecture:** Single Cloudflare Worker serves both API routes and static frontend. Google OAuth with refresh tokens stored in D1 for per-user background sync. Each user's data is scoped by user_id. Per-user Drive webhooks for instant change detection.

**Tech Stack:** React, Vite, Tailwind CSS, Cloudflare Workers, Cloudflare D1, Google OAuth 2.0, Google Docs/Drive API

---

### Task 1: Database Migration — Add Users Table and user_id Columns

**Files:**
- Create: `migrations/0002_multi_tenant.sql`
- Modify: `workers/shared/types.ts`

**What to do:**

Create migration that:
1. Creates `users` table (id, email, name, picture, google_doc_id, refresh_token, token_status, owner_emails, owner_display_names, created_at)
2. Adds `user_id TEXT` column to: sections, annotations, progress_log, paragraph_snapshots, sync_state
3. Drops old UNIQUE constraint on paragraph_snapshots and recreates with user_id
4. Updates sections seed data to NOT auto-seed (sections created per user on onboarding)

Update `types.ts`:
- Add `User` interface
- Update `Env` interface: remove OWNER_EMAIL/OWNER_EMAILS/OWNER_DISPLAY_NAMES, add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET, TOKEN_ENCRYPTION_KEY, WORKER_URL
- Add `Session` interface (user_id, email, name)

**Commit:** `feat: add multi-tenant database schema`

---

### Task 2: Auth Module — OAuth Login/Callback/Session

**Files:**
- Create: `workers/shared/auth.ts`
- Create: `workers/shared/crypto.ts`

**What to do:**

`crypto.ts`:
- `encryptToken(token, key)` — AES-GCM encrypt refresh token
- `decryptToken(encrypted, key)` — AES-GCM decrypt refresh token
- `signJWT(payload, secret)` — create signed session JWT
- `verifyJWT(token, secret)` — verify and decode session JWT

`auth.ts`:
- `getLoginUrl(env)` — build Google OAuth URL with scopes (openid, email, profile, documents.readonly, drive.readonly, drive.file)
- `handleCallback(code, env)` — exchange auth code for tokens, create/update user in D1, encrypt refresh token, return signed session cookie
- `getSession(request, env)` — extract and verify JWT from cookie, return user info or null
- `requireSession(request, env)` — like getSession but throws 401 if no session
- `refreshAccessToken(refreshToken, env)` — use refresh token to get fresh access token
- `getUserAccessToken(userId, env)` — fetch user's encrypted refresh token from D1, decrypt, refresh, return access token

**Commit:** `feat: add OAuth auth module with session management`

---

### Task 3: DB Module — Scope All Queries by user_id

**Files:**
- Modify: `workers/shared/db.ts`

**What to do:**

Every existing function gets a `userId: string` parameter added:
- `getSections(db, userId)` — WHERE user_id = ?
- `getAnnotations(db, sectionId, userId)` — WHERE user_id = ?
- `createAnnotation(db, annotation)` — annotation now includes user_id
- `addProgressEntry(db, entry)` — entry now includes user_id
- `getSnapshots(db, sectionId, userId)` — WHERE user_id = ?
- `getSyncState(db, key, userId)` — WHERE user_id = ?
- `setSyncState(db, key, value, userId)` — WHERE user_id = ?
- etc.

Add new functions:
- `createUser(db, user)` — insert into users table
- `getUser(db, userId)` — get user by ID
- `getUserByEmail(db, email)` — get user by email
- `updateUserDoc(db, userId, docId)` — set google_doc_id
- `updateUserTokenStatus(db, userId, status)` — mark needs_reauth
- `getAllActiveUsers(db)` — users with token_status='active' and google_doc_id set
- `seedSectionsForUser(db, userId)` — insert 6 default sections for a user

**Commit:** `refactor: scope all DB queries by user_id`

---

### Task 4: Refactor Sync Logic — Per-User Sync

**Files:**
- Modify: `workers/api/src/index.ts` (extract sync into its own file)
- Create: `workers/shared/sync.ts`

**What to do:**

Extract `syncDocument` from the main worker into `sync.ts`:
- `syncUserDocument(env, userId)` — fetches user's token, runs sync scoped to that user
- Owner detection: compare revision/comment authors against `users.email` (the logged-in user is always the owner)
- Also check `users.owner_emails` and `users.owner_display_names` for multi-account users
- If token refresh fails, mark user as `needs_reauth`
- All DB calls pass `userId`

Extract `renewWatch` into `sync.ts`:
- `renewUserWatch(env, userId)` — register Drive watch for a specific user's doc
- Webhook URL: `{WORKER_URL}/webhook/{userId}`

Add:
- `syncAllUsers(env)` — loop through all active users, sync each
- `renewAllWatches(env)` — loop through all active users, renew each watch

**Commit:** `refactor: extract per-user sync logic`

---

### Task 5: Refactor Main Worker — Auth Routes + Scoped API

**Files:**
- Rewrite: `workers/api/src/index.ts`

**What to do:**

New route structure:
```
GET  /auth/login        → redirect to Google OAuth
GET  /auth/callback     → handle OAuth callback, set cookie, redirect
POST /auth/logout       → clear cookie
GET  /auth/me           → return current user (or 401)

POST /api/setup         → { google_doc_url } → parse doc ID, seed sections, first sync
GET  /api/sections      → scoped by session user
GET  /api/sections/:id/annotations → scoped
PATCH /api/annotations/:id/address → auto-fill addressed_by from session
POST /api/sections/:id/status → scoped
GET  /api/progress      → scoped
POST /api/progress      → auto-fill logged_by from session
DELETE /api/progress/:id → scoped
GET  /api/activity      → scoped
POST /api/sync          → sync current user's doc

POST /webhook/:userId   → Google Drive push, trigger sync for that user

GET  /*                 → serve static frontend files
```

All `/api/*` routes call `requireSession()` first.
CORS headers no longer needed (same origin).
Remove all old env var references (OWNER_EMAIL, etc).

Cron handler: calls `renewAllWatches(env)` daily.

**Commit:** `refactor: rewrite main worker with auth + scoped routes`

---

### Task 6: Static Asset Serving

**Files:**
- Modify: `workers/api/src/index.ts`
- Modify: `wrangler.toml`
- Create: `workers/shared/assets.ts`

**What to do:**

Use Cloudflare Workers Static Assets to serve the frontend:
- In wrangler.toml, add `[assets]` config pointing to `frontend/dist`
- The worker handles API/auth/webhook routes; all other paths fall through to static assets
- `index.html` served for all non-API routes (SPA client-side routing)

Update `wrangler.toml`:
```toml
[assets]
directory = "./frontend/dist"
binding = "ASSETS"
```

Remove the separate Cloudflare Pages deployment.

**Commit:** `feat: serve frontend from worker via static assets`

---

### Task 7: Frontend — Auth State + Login Page

**Files:**
- Rewrite: `frontend/src/App.tsx`
- Rewrite: `frontend/src/api/client.ts`
- Create: `frontend/src/components/LoginPage.tsx`
- Create: `frontend/src/components/SetupPage.tsx`
- Modify: `frontend/src/components/Header.tsx`

**What to do:**

`client.ts`:
- Remove `API_BASE` — all calls are same-origin now (just `/api/...`)
- Remove `VITE_OWNER_EMAIL`
- Add `auth.login()` → redirect to `/auth/login`
- Add `auth.logout()` → POST `/auth/logout`
- Add `auth.me()` → GET `/auth/me`
- Add `api.setup(docUrl)` → POST `/api/setup`
- All other api calls stay the same (just remove API_BASE prefix)

`App.tsx`:
- On mount: call `auth.me()` to check if logged in
- Three states: `loading` → `logged_out` → `onboarding` (no doc set) → `dashboard`
- If logged out: show `LoginPage`
- If no doc: show `SetupPage`
- If has doc: show current dashboard

`LoginPage.tsx`:
- Title: "Manuscript Tracker"
- Subtitle: "Track advisor feedback on your manuscript"
- "Sign in with Google" button
- Academic minimalist style matching existing design

`SetupPage.tsx`:
- "Paste your Google Doc URL"
- Text input + "Start Tracking" button
- On submit: call `api.setup(url)`, then refresh to dashboard

`Header.tsx`:
- Show user avatar (from Google), name, logout button
- Keep "Sync Now" button

**Commit:** `feat: add login, onboarding, and auth-aware frontend`

---

### Task 8: Frontend — Settings for Multi-Account Users

**Files:**
- Create: `frontend/src/components/SettingsPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/api/client.ts`

**What to do:**

Add a settings page (accessible from header) where users can:
- Change their Google Doc URL
- Add additional owner emails (comma-separated) — for users with multiple Google accounts
- Add owner display names — for comment matching

API additions:
- `PATCH /api/settings` → update user's google_doc_id, owner_emails, owner_display_names

Keep this minimal — most users won't need it.

**Commit:** `feat: add settings page for multi-account config`

---

### Task 9: Update Config Files and Deploy

**Files:**
- Modify: `wrangler.toml`
- Modify: `wrangler.toml.example`
- Modify: `.gitignore`
- Delete: `frontend/.env`, `frontend/.env.example`
- Modify: `package.json` (update scripts)

**What to do:**

`wrangler.toml` update:
```toml
name = "manuscript-tracker"
main = "workers/api/src/index.ts"
compatibility_date = "2025-05-01"

[assets]
directory = "./frontend/dist"

[[d1_databases]]
binding = "DB"
database_name = "manuscript-tracker-db"
database_id = "..."

[vars]
WORKER_URL = "https://manuscript-tracker.xrui0419.workers.dev"
GOOGLE_CLIENT_ID = "..."

[triggers]
crons = ["0 0 * * *"]
```

Secrets (set via CLI):
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET`
- `TOKEN_ENCRYPTION_KEY`

`package.json` scripts:
```json
{
  "build": "cd frontend && npm run build",
  "deploy": "npm run build && wrangler deploy",
  "dev": "wrangler dev"
}
```

Remove `frontend/.env` and `frontend/.env.example` (no longer needed).
Remove Cloudflare Pages project (scfm-manuscript).

**Commit:** `chore: update config for single-worker deployment`

---

### Task 10: Google Cloud OAuth Setup + Run Migration + Deploy

**Manual steps:**
1. Go to Google Cloud Console → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Set authorized redirect URI: `https://manuscript-tracker.xrui0419.workers.dev/auth/callback`
4. Copy Client ID and Client Secret
5. Run:
   ```bash
   npx wrangler d1 execute manuscript-tracker-db --remote --file=migrations/0002_multi_tenant.sql
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put TOKEN_ENCRYPTION_KEY
   npx wrangler deploy
   ```
6. Test: visit the site, sign in, paste doc URL, verify sync works

**Commit:** `docs: update README for v2 web app`
