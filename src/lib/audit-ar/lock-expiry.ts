// Firebase-free lock-expiry decision logic for the expire-locks cron (Threat 6).
// Kept dependency-free (like constants.ts) so it is unit-testable without the
// Firestore emulator and safe to import into the server-only cron route.

import { LOCK_TTL_MS } from "./constants";

/**
 * A draft lock is expired when it is absent or `lockedAt + LOCK_TTL_MS` is in the
 * past. Judged with server time (admin `Date.now()` in cron, `request.time` in
 * rules) — never a client clock.
 */
export function isLockExpired(
  lockedAtMs: number | null | undefined,
  nowMs: number,
): boolean {
  return lockedAtMs == null || lockedAtMs + LOCK_TTL_MS < nowMs;
}

/**
 * True when `uid` still holds a live lock: they are the recorded owner and
 * `lockedAt + LOCK_TTL_MS` is still in the future. Used to gate draft writes and
 * submissions so a stale client (lock lost / expired / submitted) can no longer
 * mutate a unit it no longer owns.
 */
export function isLockOwnedLive(
  lockedBy: string | null | undefined,
  lockedAtMs: number | null | undefined,
  uid: string,
  nowMs: number,
): boolean {
  return lockedBy === uid && lockedAtMs != null && lockedAtMs + LOCK_TTL_MS > nowMs;
}

/** The field update the cron should apply, or `null` to leave the unit alone. */
export type SweepUpdate =
  | { status: "not_started"; lock: null } // draft → reset to not_started
  | { lock: null } // rejected → release the expired lock, keep the status
  | null;

/**
 * Decide how the cron sweeps a single unit given its status and lock age.
 *
 * - `draft` with an expired/absent lock → reset to `not_started` and clear the lock.
 * - `rejected` with an actually-expired lock → release the lock but STAY rejected
 *   (a rejected unit must never silently become not_started).
 * - anything else (fresh locks, other statuses, an already lock-less rejected) →
 *   left untouched.
 *
 * Replaces the old bug where the cron read a nonexistent `lockExpiresAt`, judged
 * every draft "expired", and wiped live locks on each nightly run.
 */
export function sweepDecision(
  status: string,
  lockedAtMs: number | null | undefined,
  nowMs: number,
): SweepUpdate {
  if (status === "draft") {
    return isLockExpired(lockedAtMs, nowMs)
      ? { status: "not_started", lock: null }
      : null;
  }
  if (status === "rejected") {
    // Only act on an existing-but-expired lock; a rejected unit with no lock is
    // already clean.
    return lockedAtMs != null && isLockExpired(lockedAtMs, nowMs)
      ? { lock: null }
      : null;
  }
  return null;
}

/**
 * Cron auth is fail-closed: it requires `CRON_SECRET` to be set AND the request
 * to carry the exact matching bearer token. (The old check was fail-open when the
 * secret was unset.)
 */
export function cronAuthorized(
  secret: string | undefined,
  authHeader: string | null,
): boolean {
  return Boolean(secret) && authHeader === `Bearer ${secret}`;
}
