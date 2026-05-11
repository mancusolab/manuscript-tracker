# Manuscript Tracker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a manuscript tracking website that syncs with Google Docs to track advisor edits per section/paragraph and surfaces them on an academic-minimalist dashboard.

**Architecture:** Cloudflare Pages (React+Vite frontend) + 2 Cloudflare Workers (API + Sync cron) + D1 SQLite database. Sync worker polls Google Docs API every 15 min, diffs paragraph-level content, creates annotations, and posts/resolves Google Doc comments. Frontend shows section progress, paragraph annotations, and activity timeline.

**Tech Stack:** React, Vite, Tailwind CSS, Cloudflare Workers, Cloudflare D1, Google Docs API, TypeScript

---

### Task 1: Project Scaffolding & Config

**Files:**
- Create: `package.json`
- Create: `wrangler.toml`
- Create: `tsconfig.json`
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tailwind.config.js`
- Create: `frontend/index.html`

### Task 2: D1 Database Schema

**Files:**
- Create: `migrations/0001_init.sql`
- Create: `workers/shared/types.ts`

### Task 3: Shared Worker Utilities

**Files:**
- Create: `workers/shared/db.ts`
- Create: `workers/shared/google-auth.ts`
- Create: `workers/shared/doc-parser.ts`

### Task 4: API Worker

**Files:**
- Create: `workers/api/src/index.ts`

### Task 5: Sync Worker

**Files:**
- Create: `workers/sync/src/index.ts`

### Task 6: Frontend — Layout & Section Dashboard

**Files:**
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/index.css`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/components/Header.tsx`
- Create: `frontend/src/components/SectionPanel.tsx`
- Create: `frontend/src/components/SectionList.tsx`

### Task 7: Frontend — Paragraph Annotations & Timeline

**Files:**
- Create: `frontend/src/components/AnnotationTrail.tsx`
- Create: `frontend/src/components/ActivityTimeline.tsx`
- Create: `frontend/src/components/ProgressForm.tsx`

### Task 8: Frontend Styling — Academic Minimalist

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/tailwind.config.js`
