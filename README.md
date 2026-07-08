# Audit AR

**Audit Account Receivable** — a field-audit tool for property units. Supervisors
manage a master list of units, assign field auditors, and review submissions; field
auditors fill in audit forms and upload photos from the field.

Next.js 16 (App Router) · Firebase (Auth + Firestore) · Google Drive (photos) ·
Tailwind CSS v4 · shadcn/ui.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill in the values
npm run dev                         # http://localhost:3000
```

## First-time setup

This app needs its **own** Firebase project. See `SETUP.md` for the full checklist
(create the Firebase project, deploy rules + indexes, configure Google Drive OAuth,
bootstrap the first supervisor, and deploy to Vercel).

## Routes

- `/` — post-login landing; redirects to your Audit AR workspace
- `/audit-ar/supervisor/*` — dashboard, units, import, categories, review queue, team
- `/audit-ar/field/*` — assigned units, audit form, photo upload
