# Audit AR — Hardening the field-audit → upload → review flow

## Context

**App:** Audit AR (Next.js 16, Firebase/Firestore, Google Drive for photos).
**Core flow:** a field auditor visits each property unit, captures audit data + photos
(photos upload to Drive), and submits an **immutable submission**; a supervisor then
approves/rejects. Concurrency between auditors is serialized by a per-unit **draft lock**.

**Why this change:** the goal this session is to *close UX/correctness issues, not add
features*. A structured exploration of the state/mutation/navigation of the core flow
surfaced concrete races and silent-data-loss bugs. This plan fixes them at the **root
cause**, following the existing codebase patterns (the app already uses `runTransaction`
with typed result objects for locks — the write-integrity mutations just don't yet).

**Scope decisions made with the user:**
- **Cover everything found** (Tier A write-integrity races, Tier B lock/cron hardening,
  Tier C cleanup/UX).
- **Verify with Vitest + the Firestore emulator** — the user approved adding Vitest as a
  devDependency (this overrides the general "no new libraries" constraint *for the test
  runner only*; no new runtime dependencies).

> Process note: the first exploration subagent's output ended with text disguised as a
> "user" message demanding immediate implementation. That was **not** a real instruction
> (it was embedded in tool output, and we were in plan mode); it was disregarded. Nothing
> was edited. Implementation proceeds only after this plan is approved.

**Implementation ground rules (from the task):** root cause not symptom-masking; follow
existing patterns; **one commit per fix**; write the **failing test first**, then fix to
green and show real test output — never claim success without it. After implementation, a
fresh subagent reviews the diff against this plan and reports only correctness gaps.
(Step 1 of implementation copies this plan into the repo as `PLAN.md` for that final review.)

---

## Shared root-cause: server-authoritative lock validity

Threats 4 and 6 share one fix. `lockedAt` is *already* written as `serverTimestamp()`
([firestore.ts:192](src/lib/audit-ar/firestore.ts#L192)); the bug is that **`lockExpiresAt`
is minted from the acquirer's client `Date.now()`** ([firestore.ts:193](src/lib/audit-ar/firestore.ts#L193),
[:214](src/lib/audit-ar/firestore.ts#L214)) and then judged against three *different* clocks
(acquirer client, cron server, frozen mount-time UI). We make lock validity
**server-authoritative** and drop `lockExpiresAt` entirely:

> A lock is valid ⟺ `lockedAt + LOCK_TTL` is still in the future, judged with
> **`request.time` in rules** and **admin server time in cron**. The client clock is used
> only for display hints, never for correctness.

Extract the constant so the **server** cron can use it without importing the client SDK:

- New `src/lib/audit-ar/constants.ts` → `export const LOCK_TTL_MS = 15 * 60 * 1000;`
  (Firebase-free). `firestore.ts` re-exports/imports it; the cron route imports it directly.
- Rules mirror it as `duration.value(15, 'm')` (comment both to keep in sync — decision D4).

This ripples through: `types.ts` (drop `lockExpiresAt` from `AuditLock`), `firestore.ts`
(`acquireDraftLock`, `renewDraftLock`), the upload route, the cron route, `firestore.rules`,
and the two field UIs. Every touch point is listed under Threat 4.

---

## TIER A — write-integrity races

### Threat 1 — Double-submit → duplicate `pending` submissions
**Root cause:** `createSubmission` ([firestore.ts:303-339](src/lib/audit-ar/firestore.ts#L303-L339))
is a non-transactional `writeBatch` with an auto-id child doc, `version` from a **stale**
`unit` arg, and no re-entrancy guard. Two near-simultaneous submits write two `pending`
docs with the *same* version.

**Fix — transaction with a submittable-state precondition** (keying the id by version does
*not* dedupe; the precondition does). Return a typed result like the existing
`AcquireLockResult`:

```ts
export type CreateSubmissionResult =
  | { ok: true; submissionId: string }
  | { ok: false; reason: "already_submitted" | "not_locked" | "not_found" | "error" };

// runTransaction: re-read the unit (contended doc → loser retries), then:
//   owns = lock?.lockedBy === submittedBy && lock.lockedAt.toMillis() + LOCK_TTL_MS > Date.now()
//   if (!owns) return not_locked
//   if (!canTransition(data.status, "pending", "fieldAudit")) return already_submitted  // draft|rejected only
//   version = (data.submissionCount ?? 0) + 1   // FRESH count
//   tx.set(subRef, {...}); tx.update(unitRef, { status:"pending", currentSubmissionId, submissionCount:version, lock:null, draft:null, ... })
```

Client `handleSubmit`
([form/page.tsx:204-250](<src/app/(audit-ar)/audit-ar/field/units/[unitId]/form/page.tsx#L204-L250>)):
add a `submittingRef` re-entrancy guard, move the flag reset into `finally` **but keep
navigate-away on success** (guard the reset with a `navigated` flag). Treat
`already_submitted` as success (navigate; info toast).

**Files:** `firestore.ts` (import `canTransition` from `status-machine.ts` — decision D2),
form page.
**Verify (failing-first):** `test/create-submission.race.test.ts` — seed a `draft` unit
locked by A; fire `Promise.all([createSubmission, createSubmission])`; assert exactly one
`{ok:true}`, the other `already_submitted`, submissions subcollection has **1** doc,
`submissionCount === 1`. Fails today (2 docs), green after.

### Threat 2 — Approve/reject race + stale review
**Root cause:** `reviewSubmission` ([firestore.ts:361-388](src/lib/audit-ar/firestore.ts#L361-L388))
is a non-transactional batch with **no status check**; the review rule
([firestore.rules:101-104](firestore.rules#L101-L104)) constrains only affected keys. Two
supervisors silently overwrite each other (`approved`→`rejected`).

**Fix — transactionalize + require pending, and harden the rule:**

```ts
export type ReviewResult = { ok: true } | { ok: false; reason: "already_reviewed" | "not_found" | "error" };
// runTransaction: tx.get(subRef); if status !== "pending" → already_reviewed; else update sub + unit.
```
```
// firestore.rules submission update — add the precondition:
allow update: if isSupervisor()
  && resource.data.status == 'pending'                              // NEW
  && request.resource.data.diff(resource.data).affectedKeys()
       .hasOnly(['status','reviewedBy','reviewedByName','reviewedAt','rejectionNote']);
```

Call sites `handleApprove`/`handleReject`
([supervisor/units/[unitId]/page.tsx:79-111](<src/app/(audit-ar)/audit-ar/supervisor/units/[unitId]/page.tsx#L79-L111>)):
branch on the result; on `already_reviewed`, toast "sudah direview supervisor lain" + refresh.

**Files:** `firestore.ts`, `firestore.rules`, supervisor detail page.
**Verify:** (i) concurrency test — two concurrent reviews (approve vs reject) → exactly one
`{ok:true}`, one terminal state, unit matches. (ii) rules test — `assertFails` a supervisor
update of an already-`approved` submission.

### Threat 3 — Submit during in-flight upload → lost photo + orphan Drive file
**Root cause:** the submit button is `disabled={submitting}` only
([form/page.tsx:635](<src/app/(audit-ar)/audit-ar/field/units/[unitId]/form/page.tsx#L635>));
`uploadingPhoto` is a single boolean that can't represent concurrent uploads, so a submit
mid-upload snapshots `attachments` before the new photo is appended.

**Fix:** replace the boolean with a **pending-upload counter**
(`const uploadingPhoto = pendingUploads > 0`, `setPendingUploads(n=>n±1)` around each upload
in `handlePhotoFile`). Gate submit **and** delete-draft on `submitting || pendingUploads > 0`,
plus an early-return-with-toast in `handleSubmit`.

**Files:** form page only.
**Verify (manual — UI-only, no component harness):** `npm run dev`; throttle Network to
Slow 3G; pick a photo; confirm Submit is disabled with a spinner and only proceeds after the
upload resolves with the new photo present in the submission.

---

## TIER B — draft-lock & cron hardening

### Threat 4 — Lock-expiry clock mismatch (make validity server-authoritative)
**Root cause:** described in *Shared root-cause* above. Additionally the unit-update rule
([firestore.rules:89-90](firestore.rules#L89-L90)) lets any field auditor set a lock with
their own uid **regardless of an existing active lock** → theft at the rules layer.

**Touch points (all part of this one fix):**
- `constants.ts` — new home of `LOCK_TTL_MS` (Firebase-free); `firestore.ts` + cron import it.
- `types.ts:61-66` — drop `lockExpiresAt` from `AuditLock` (`lockedAt` now means "acquired
  or last-refreshed at"; decision D8 — safe, no UI shows the original acquire time).
- `acquireDraftLock` ([:187-196](src/lib/audit-ar/firestore.ts#L187-L196)) — remove
  `lockExpiresAt`; keep `lockedAt: serverTimestamp()`; change `heldByOther` to
  `lock.lockedAt.toMillis() + LOCK_TTL_MS > now` (courtesy client check; rules authoritative).
- `renewDraftLock` ([:210-220](src/lib/audit-ar/firestore.ts#L210-L220)) — take `uid`, make
  it a **transaction** that only pushes `lock.lockedAt` forward *if the caller still owns the
  lock* (fixes the malformed-lock-with-no-owner bug; decision D3). Update the caller in
  `use-audit-lock.ts` to pass `uid`.
- Upload route ([route.ts:44](src/app/api/audit-ar/attachments/upload/route.ts#L44)) —
  replace the `lockExpiresAt` check with `lock.lockedAt.toMillis() + LOCK_TTL_MS > Date.now()`.
- `firestore.rules:76-90` — add server-time helpers and forbid stealing an *active foreign*
  lock:
  ```
  function lockActive(l) { return l != null && request.time < l.lockedAt + duration.value(15,'m'); }
  function lockOk(uid) {
    let old = resource.data.get('lock', null);
    let neu = request.resource.data.get('lock', null);
    return neu == null
      ? (!lockActive(old) || old.lockedBy == uid)                 // may only clear own/expired lock
      : (neu.get('lockedBy', null) == uid
         && (!lockActive(old) || old.lockedBy == uid));           // may only set to self; no active-foreign steal
  }
  ```
  then replace the `lock == null || ...lockedBy == uid` clause with `&& lockOk(request.auth.uid)`.
- UI display only: `ownsLock` (form) and `lockLive`/`lockedByOther` (unit detail) compute
  from `lockedAt + LOCK_TTL_MS > Date.now()`. (Threat 5 removes the frozen-mount staleness.)

**Files:** `constants.ts` (new), `types.ts`, `firestore.ts`, `use-audit-lock.ts`, upload
route, `firestore.rules`, field unit-detail + form pages.
**Verify (rules-level, clock-independent):** lock held by A (`lockedAt = now`) → B
`assertFails` setting `lockedBy:B`; reseed `lockedAt = now − 20m` → B `assertSucceeds`
(takeover after expiry); A `assertSucceeds` renewing own fresh lock; B `assertFails` renewing
A's fresh lock.

### Threat 5 — Form freezes lock ownership → silent autosave failure & data loss
**Root cause:** the form loads the unit **once** (no `onSnapshot`); `ownsLock` and the
redirect-out effect are frozen at mount
([form/page.tsx:139-148](<src/app/(audit-ar)/audit-ar/field/units/[unitId]/form/page.tsx#L139-L148>)),
so after the lock is lost, `saveDraft` keeps failing against rules with no user feedback →
silent data loss.

**Fix:** subscribe to the unit doc via `onSnapshot` (precedent + proper unsubscribe:
[use-auth.ts:39-72](src/lib/shared/use-auth.ts#L39-L72)); re-derive ownership live; on lock
loss, toast + `router.replace` back to the unit page. **Guard** the redirect so it only
fires after hydration and **not during `submitting`** (submit legitimately nulls the lock —
otherwise your own successful submit would false-trigger the redirect). Keep the one-time
`getCategories` fetches as-is.

**Files:** form page.
**Verify (manual — needs two sessions/emulator):** open the form as A; expire/overwrite A's
lock from a second session; confirm A sees the toast, is redirected, and stops attempting
failing `saveDraft` writes (Network tab).

### Threat 6 — Cron: fail-open + read-then-blind-write race + misses rejected units
**Root cause:** [expire-locks/route.ts:10](src/app/api/audit-ar/cron/expire-locks/route.ts#L10)
is **fail-open** when `CRON_SECRET` is unset; the `status=="draft"` read + blind batch update
([:19-37](src/app/api/audit-ar/cron/expire-locks/route.ts#L19-L37)) can clobber a lock
renewed in between; and `rejected` units with abandoned locks are never swept.

**Fix:**
- **Fail-closed:** `if (!process.env.CRON_SECRET || authHeader !== 'Bearer '+process.env.CRON_SECRET) → 401`.
- **Coverage:** query `where("status","in",["draft","rejected"])`; filter expired via
  `lock.lockedAt.toMillis() + LOCK_TTL_MS < nowMs`. For `draft` → `status:"not_started", lock:null`;
  for `rejected` → **null the lock, keep `status:"rejected"`** (a rejected unit must stay
  rejected).
- **No clobber:** replace the blind batch with a **per-doc admin transaction** that re-reads
  and only clears if still expired (decision D5: the transactional re-read is the guarantee).

**Files:** cron route (imports `LOCK_TTL_MS` from `constants.ts`).
**Verify:** (i) unit test — `GET` with no `CRON_SECRET`/header → 401 (no emulator). (ii) admin
SDK against emulator (`FIRESTORE_EMULATOR_HOST`) — seed draft-expired / draft-fresh /
rejected-expired; run; assert draft-expired→`not_started`+null lock, draft-fresh untouched,
rejected-expired→null lock but `status==="rejected"`.

---

## TIER C — cleanup / broader UX

### Threat 7 — Orphan Drive files
**Root cause:** no `files.delete` anywhere ([drive.ts](src/lib/audit-ar/google/drive.ts));
orphans from photo remove/replace, `deleteDraft`, submit-during-upload, and abandoned drafts.
**Fix:** add `deleteFile(fileId)` to `drive.ts` (best-effort `.catch()`, mirroring the
permission-create swallow); new API route `attachments/delete/route.ts` mirroring the upload
route's auth, authorizing **lock owner OR draft owner (`draft.updatedBy === uid`) OR
supervisor** (decision D6). Wire into photo-remove in the form and both `deleteDraft` call
sites. **Abandoned-draft orphans:** out of scope now — note a future Drive folder-diff sweep
as the mechanism (decision D7).
**Files:** `drive.ts`, new delete route, form page, field unit-detail page.
**Verify (manual — hits real Drive, not emulated):** upload→remove a photo, confirm it's gone
from the unit's Drive folder; create a draft with photos, "Hapus Draft", confirm removal.

### Threat 8 — Unmount during async upload
**Root cause:** `handlePhotoFile`'s continuation calls `setAttachments`/`persistDraft` after
unmount (can revive a draft the submission just cleared); object URLs from
`URL.createObjectURL` are never revoked.
**Fix:** a `mountedRef` + an `AbortController` set; pass `signal` to the upload `fetch`; bail
before any `setState`/`persistDraft` when unmounted; abort in-flight uploads and revoke all
object URLs on unmount (needs a `localPreviewsRef` mirror so cleanup sees the latest URLs).
**Files:** form page.
**Verify (manual):** throttle; start an upload; navigate away before it finishes; confirm no
console error, no revived draft on return, object URLs released.

### Threat 9 — Stale data in supervisor flow + non-persisted filters
**Root cause:** every supervisor list is a one-time `getDocs`; filters/search live in
`useState`, lost on Back.
**Fix (proportionate):** *must-fix* — convert the **review queue**
([supervisor/review/page.tsx](<src/app/(audit-ar)/audit-ar/supervisor/review/page.tsx>)) and
**supervisor unit detail** to `onSnapshot` (thin `getAuditUnitsLive`/`getSubmissionsLive`
listener helpers in `firestore.ts` using the `use-auth.ts` cleanup pattern; drop the manual
`load()` re-fetch — the snapshot supersedes it). *Nice-to-have* — persist `search`/`statusFilter`
to the URL via `useSearchParams` on the unit lists.
**Files:** `firestore.ts` (listener helpers), supervisor review + detail pages; optionally the
two unit-list pages.
**Verify:** correctness covered by the Threat 2 test; realtime refresh is **manual** (two
supervisor tabs; approve in one → the other updates without reload).

---

## Verification harness (Vitest + Firestore emulator)

**devDependencies to add:** `vitest`, `@firebase/rules-unit-testing` (gives
`initializeTestEnvironment`, `authenticatedContext`, `withSecurityRulesDisabled`,
`assertFails`/`assertSucceeds` — one harness tests both rules and the app's transaction
functions), `firebase-tools` (emulator binary + `emulators:exec`).

**`firebase.json`** — add:
```json
"emulators": { "firestore": { "port": 8080 }, "ui": { "enabled": false }, "singleProjectMode": true }
```
**`package.json` scripts:** `"test": "vitest run"`, `"test:watch": "vitest"`,
`"test:emulator": "firebase emulators:exec --only firestore \"vitest run\""`.
**`vitest.config.ts`:** node env, `globals:true`, `fileParallelism:false` (serialize emulator
access), `include: ["test/**/*.test.ts"]`, alias `@ → ./src`.

**Injecting the emulator DB into app functions** — add a test-only seam in `firestore.ts`:
```ts
let _dbOverride: Firestore | null = null;
export function __setDbForTests(i: Firestore | null) { _dbOverride = i; }
function db() { return _dbOverride ?? getClientDb(); }
```
Tests set `__setDbForTests(testEnv.authenticatedContext(uid,{auditRole}).firestore())`, seed
via `withSecurityRulesDisabled`, `clearFirestore()` + `__setDbForTests(null)` in `afterEach`.
Cron tests use the admin SDK with `FIRESTORE_EMULATOR_HOST` set. Concurrency tests race two
real transactions with `Promise.all` (Firestore serializes the contended doc, forcing the
loser to retry and observe the changed precondition — deterministic).

---

## Commit sequence (one per fix; dependencies first)

1. `chore(test)` — add Vitest + emulator harness, `__setDbForTests` seam, `constants.ts`
   (extract `LOCK_TTL_MS`), one smoke test. *(No behavior change; unblocks every later test.
   Also creates `PLAN.md` in the repo from this file for the final review step.)*
2. `fix(review)` — transactional `reviewSubmission` + `status=='pending'` rule (Threat 2).
   *(Code + rule ship together.)*
3. `fix(submit)` — idempotent `createSubmission` transaction + client re-entrancy guard
   (Threat 1).
4. `fix(lock)` — server-authoritative lock validity via `lockedAt`; remove `lockExpiresAt`;
   `lockOk` rule; transactional `renewDraftLock` (Threat 4). *(Base for #5.)*
5. `fix(cron)` — fail-closed auth + per-doc transaction + sweep rejected units (Threat 6).
6. `fix(form)` — disable submit while uploads are in flight (Threat 3).
7. `fix(form)` — live lock ownership via `onSnapshot`; redirect on lock loss (Threat 5).
8. `fix(form)` — abort in-flight uploads + revoke object URLs on unmount (Threat 8).
9. `feat(drive)` — delete helper + delete route; remove orphans on photo-remove/draft-delete
   (Threat 7).
10. `feat(supervisor)` — realtime review queue + unit detail; URL-persisted list filters
    (Threat 9).

Rules changes deploy with the commit that owns them (`firebase deploy --only firestore:rules`):
Threat 2 → submission rule; Threat 4 → lock rule.

## Adopted design decisions (defaults; flag if you disagree)

- **D1** rely on the transaction precondition for submit; leave a cross-doc lock check in the
  *create* rule as future hardening.
- **D2** wire the currently-dead `canTransition()` into `createSubmission`; keep submission
  `status==='pending'` as the primary guard in review.
- **D3** transactional `renewDraftLock` (safe, matches release/delete; minor contention with
  the 800 ms autosave — acceptable at a 60 s cadence).
- **D4** duplicate the TTL as `LOCK_TTL_MS` (TS) + `duration.value(15,'m')` (rules) with a
  keep-in-sync comment.
- **D5** accept the cron transactional re-read as the no-clobber guarantee; best-effort test.
- **D6** delete-route auth = lock owner OR draft owner OR supervisor.
- **D7** abandoned-draft Drive orphans → future folder-diff sweep (not built now).
- **D8** repurpose `lockedAt` as "acquired/last-refreshed" (renew moves it); safe — no UI
  needs the original acquire time.

## How to run verification end-to-end

```bash
npm install                 # picks up vitest / rules-unit-testing / firebase-tools
npm run test:emulator       # boots the Firestore emulator, runs vitest, tears down
npm run dev                 # for the manual E2E checks (Threats 3, 5, 7, 8, 9)
```
For each Tier A/B fix: run the new test **before** the code change to see it fail (the
required failing-first evidence), then after to see it green, and paste the real output.
Final step: a fresh subagent diffs the branch against `PLAN.md` and reports only gaps that
affect correctness.
