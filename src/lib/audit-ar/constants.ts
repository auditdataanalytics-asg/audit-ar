// Firebase-free constants shared across client (firestore.ts) and server (cron
// route with firebase-admin). Kept dependency-free so the server bundle never
// pulls in the client SDK just to read a number.

// Draft-lock time-to-live. A lock is valid while `lockedAt + LOCK_TTL_MS` is in
// the future. Keep this in sync with `duration.value(15, 'm')` in firestore.rules.
export const LOCK_TTL_MS = 15 * 60 * 1000; // 15 minutes
