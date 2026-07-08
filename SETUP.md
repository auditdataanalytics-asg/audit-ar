# Audit AR — first-time setup

This app runs on its **own dedicated Firebase project**, separate from the LMS.
Follow these steps once. Commands assume the Firebase CLI (`npm i -g firebase-tools`)
and Node are installed.

## 1. Create the Firebase project

1. In the [Firebase console](https://console.firebase.google.com), create a new
   project (e.g. `audit-ar-prod`).
2. **Authentication** → enable the **Email/Password** and **Google** sign-in providers.
3. **Firestore Database** → create a database (production mode, pick a region).

## 2. Wire up environment variables

```bash
cp .env.local.example .env.local
```

- **Web app config:** Firebase console → Project settings → *Your apps* → add a **Web app**.
  Copy the 6 values into `.env.local`:
  `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`,
  `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`,
  `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`.
- **Service account (Admin SDK):** Project settings → *Service accounts* →
  **Generate new private key**. Save it at the **repo root** as `service-account.json`
  (gitignored) — this is where the `scripts/*.ts` helpers read it from
  (`path.resolve(__dirname, "../service-account.json")`). Set
  `FIREBASE_ADMIN_CLIENT_EMAIL` + `FIREBASE_ADMIN_PRIVATE_KEY` in `.env.local`
  (the private key must keep its `\n` escapes, wrapped in quotes).

## 3. Deploy Firestore rules + indexes

Point `.firebaserc` at the new project (replace the placeholder), then:

```bash
firebase use <new-project-id>
firebase deploy --only firestore:rules,firestore:indexes
```

The 5 composite indexes (`auditUnits` x4, `submissions` collection-group) are required
by the review/queue/list queries. Rules are in `firestore.rules`.

## 4. Google Drive (photo attachments)

Photos go to Google Drive (independent of Firebase). You can **reuse the same OAuth
credentials** from the original app, or create fresh ones:

1. Google Cloud Console → create an **OAuth 2.0 Web client** (or reuse the existing one).
2. Generate a refresh token (registers redirect `http://localhost:5555/oauth2callback`):
   ```bash
   npx tsx scripts/get-drive-refresh-token.ts <CLIENT_ID> <CLIENT_SECRET>
   ```
3. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
   `GOOGLE_OAUTH_REFRESH_TOKEN`, and optionally `AUDIT_AR_DRIVE_ROOT_FOLDER_ID`
   (a Drive folder ID to nest uploads under).
4. Set `CRON_SECRET` to any random string (protects the lock-expiry cron).

## 5. Bootstrap the first supervisor

Firestore/Auth start empty. Create the first supervisor:

1. `npm run dev`, then **sign up** a user through the app's `/register` page.
2. Grant that user the supervisor role (uses `scripts/service-account.json`):
   ```bash
   npx tsx scripts/set-audit-role.ts <UID> supervisor
   ```
   (Find the UID in Firebase console → Authentication.)
3. **Sign out and back in** so the new `auditRole` custom claim is picked up.
4. (Optional) seed the building-condition / building-type category lists:
   ```bash
   npx tsx scripts/seed-audit-categories.ts
   ```

After this, the supervisor assigns field-audit roles in-app at
`/audit-ar/supervisor/team`.

## 6. Deploy to Vercel

1. Create a new Vercel project pointing at this repo.
2. Add every variable from `.env.local` to the Vercel project's Environment Variables.
3. `vercel.json` defines a daily cron (`/api/audit-ar/cron/expire-locks`, `0 18 * * *`)
   that clears abandoned draft locks. Confirm your Vercel plan allows the schedule —
   lazy lock-expiry works even without the cron.

## Verify end-to-end

- Supervisor: create/import a unit, assign a field auditor, see the review queue.
- Field auditor: open a unit, acquire the draft lock, upload a photo (Drive upload
  succeeds), submit; supervisor approves/rejects.
- A signed-in user with no audit role lands on the "no workspace available" screen.
