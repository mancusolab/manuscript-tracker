# Manuscript Tracker

Automatically sync your Google Doc comments/edits with a progress dashboard. Never lose track of advisor feedback again.

**Try it now:** [manuscript-tracker.com](https://manuscript-tracker.com)

<p align="center">
  <img src="docs/demo.gif" width="150" alt="Manuscript Tracker Demo">
</p>

**How it works:**

1. Sign in with Google and paste your manuscript's Google Doc URL
2. Your advisor edits or comments on your manuscript in Google Docs
3. The tracker picks up the changes and shows them as a checklist
4. You address the feedback and revise — the system marks items as done
5. A progress bar shows how far each section is from completion

![Manuscript Tracker UI](docs/screenshot.png)

## Features

- **Zero setup** — sign in with Google, paste your Doc URL, done
- **Google Docs sync** — automatically detects text edits and comments from advisors via Google Drive push notifications
- **Section tracking** — monitors 6 manuscript sections (Abstract, Introduction, Materials & Methods, Results, Discussion, Supplement)
- **Paragraph-level annotations** — shows exactly which paragraphs were edited or commented on, by whom, and when
- **Comment tracking** — advisor comments from Google Docs appear with the full comment text
- **Mark as addressed** — resolve annotations from the dashboard, or auto-resolve by editing the paragraph in Google Docs
- **Progress bar** — visual overview of manuscript completion
- **Activity timeline** — chronological feed of all edits, comments, and progress updates
- **Progress logging** — manually log your own progress with notes per section
- **Multi-account support** — configure additional email addresses and display names in settings

## Tech Stack

- **Frontend:** React + Vite + Tailwind CSS (academic minimalist design)
- **Backend:** Cloudflare Workers (single worker serves API + static assets)
- **Database:** Cloudflare D1 (SQLite)
- **Auth:** Google OAuth 2.0 with encrypted refresh tokens
- **APIs:** Google Docs API + Google Drive API (push notifications)
- **Hosting:** Cloudflare Workers (free tier)

## Self-Hosting

Want to run your own instance? Here's how.

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A [Cloudflare](https://cloudflare.com) account (free tier works)
- A [Google Cloud](https://console.cloud.google.com) project

### 1. Clone and install

```bash
git clone https://github.com/mancusolab/manuscript-tracker.git
cd manuscript-tracker
npm install
cd frontend && npm install && cd ..
```

### 2. Google Cloud setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. Enable **Google Docs API** and **Google Drive API** in APIs & Services > Library
4. Go to **Google Auth Platform > Branding** — fill in app name and support email
5. Go to **Google Auth Platform > Audience** — select External
6. Go to **Google Auth Platform > Clients** > Create Client
   - Application type: **Web application**
   - Authorized redirect URI: `https://your-worker-url/auth/callback`
7. Copy the **Client ID** and **Client Secret**

### 3. Cloudflare setup

```bash
npx wrangler login
npx wrangler d1 create manuscript-tracker-db
```

Copy `wrangler.toml.example` to `wrangler.toml` and fill in your values:

```bash
cp wrangler.toml.example wrangler.toml
```

Edit `wrangler.toml`:
- Set `database_id` from the D1 create output
- Set `WORKER_URL` to your worker URL
- Set `GOOGLE_CLIENT_ID` to your OAuth client ID

### 4. Set secrets and deploy

```bash
# Run database migrations
npx wrangler d1 execute manuscript-tracker-db --remote --file=migrations/0001_init.sql
npx wrangler d1 execute manuscript-tracker-db --remote --file=migrations/0002_multi_tenant.sql

# Set secrets
npx wrangler secret put GOOGLE_CLIENT_SECRET
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
openssl rand -base64 32 | npx wrangler secret put TOKEN_ENCRYPTION_KEY

# Build and deploy
npm run deploy
```

Visit your worker URL, sign in with Google, and paste a Google Doc URL to start tracking.

## Local Development

```bash
npx wrangler dev
```

This runs the worker locally with the frontend. Visit `http://localhost:8787`.

## Customizing Sections

The default sections are: Abstract, Introduction, Materials & Methods, Results, Discussion, Supplement.

To customize, edit the section definitions in:
- `workers/shared/doc-parser.ts` — heading patterns for parsing
- `workers/shared/db.ts` — `seedSectionsForUser` function

## License

MIT
