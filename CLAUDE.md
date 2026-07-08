# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # Start dev server (http://localhost:3000)
npm run build    # Production build
npm run lint     # ESLint (flat config, eslint.config.mjs)
```

No test runner is configured.

## Architecture

This is a **Next.js 16** app (App Router): **Audit AR** (Audit Account Receivable) — a
field-audit tool for property units. It uses **Firebase** for auth + Firestore,
**Tailwind CSS v4**, and **shadcn/ui** (base-nova style). Photo attachments are
stored in **Google Drive** (not Firebase Storage).

This app was extracted from a shared multi-workspace monorepo (LMS + Audit AR). It
keeps the modular "workspace" shell (a single-module registry) so the code stays
symmetric with its origin, but it runs against its **own dedicated Firebase project**.

### Route Groups

- `(auth)` — login/register pages with their own layout
- `(workspace)` — post-login landing (`/`); redirects an authorized user to their
  Audit AR landing, or shows a "no workspace available" screen for a user with no role
- `(audit-ar)` — the app itself under `/audit-ar/*` (supervisor + field-audit shells)

### Key Patterns

- **Firebase client SDK** (`src/lib/firebase/config.ts`) — singleton `getClientAuth()` / `getClientDb()`
- **Firebase Admin SDK** (`src/lib/firebase/admin.ts`) — server-side only, in API routes; from env (`FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`)
- **Firestore data layer** (`src/lib/audit-ar/firestore.ts`) — units, immutable submissions, draft-lock transactions, categories, imports. Collections: `auditUnits`, `auditUnits/{id}/submissions`, `auditCategories`, `auditImports`, plus the shared `users`
- **Auth roles** — Audit AR role (`supervisor` | `fieldAudit`) lives on `users/{uid}.modules.auditAr` and in the `auditRole` Firebase custom claim; set via `/api/audit-ar/set-role` (supervisor-gated) or the bootstrap script
- **Google Drive** (`src/lib/audit-ar/google/`) — OAuth refresh-token upload of photos, compressed client-side, via `/api/audit-ar/attachments/upload`
- **Draft lock** — 15-min TTL, 60s heartbeat, Firestore-transaction acquire/reclaim; lazy expiry + Vercel cron `/api/audit-ar/cron/expire-locks`
- **Zustand** (`src/lib/workspace/workspace-store.ts`) — remembers last workspace
- **Zod validators** (`src/lib/audit-ar/validators.ts`)

### Path Alias

`@/*` maps to `./src/*` (configured in `tsconfig.json`).

### Firestore Security

Role-based access via custom claims (`request.auth.token.auditRole`). Rules are in `firestore.rules`. Users read/write their own user doc; audit access is gated by role.

### Admin Scripts

`scripts/` — `set-audit-role.ts` (bootstrap first supervisor), `seed-audit-categories.ts` (seed lists), `get-drive-refresh-token.ts` (one-time Drive OAuth). All use `scripts/service-account.json` (gitignored) for the Admin SDK.

### Environment Variables

Client-side (`NEXT_PUBLIC_`): Firebase config. Server-side: `FIREBASE_ADMIN_*`, `GOOGLE_OAUTH_*`, `AUDIT_AR_DRIVE_ROOT_FOLDER_ID`, `CRON_SECRET`. See `.env.local.example`.
