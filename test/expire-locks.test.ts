import { describe, it, expect } from "vitest";
import { LOCK_TTL_MS } from "@/lib/audit-ar/constants";
import {
  cronAuthorized,
  isLockExpired,
  sweepDecision,
} from "@/lib/audit-ar/lock-expiry";

// Pure-logic tests for the expire-locks cron (Threat 6). These run under a plain
// `vitest run` (no Firestore emulator / Java needed) because the sweep decision
// and auth check are extracted into a Firebase-free module. The route just applies
// `sweepDecision` inside a per-doc transaction that re-reads with fresh server time.

const NOW = 1_700_000_000_000;
const FRESH = NOW - 60_000; // 1 min old — still within TTL
const EXPIRED = NOW - (LOCK_TTL_MS + 60_000); // older than the 15-min TTL

describe("expire-locks — isLockExpired", () => {
  it("treats an absent lock as expired (nothing to protect)", () => {
    expect(isLockExpired(null, NOW)).toBe(true);
    expect(isLockExpired(undefined, NOW)).toBe(true);
  });
  it("treats a fresh lock as not expired", () => {
    expect(isLockExpired(FRESH, NOW)).toBe(false);
  });
  it("treats a lock older than the TTL as expired", () => {
    expect(isLockExpired(EXPIRED, NOW)).toBe(true);
  });
});

describe("expire-locks — sweepDecision (Threat 6)", () => {
  it("draft + expired lock → reset to not_started and clear the lock", () => {
    expect(sweepDecision("draft", EXPIRED, NOW)).toEqual({
      status: "not_started",
      lock: null,
    });
  });

  it("draft + fresh lock → LEFT UNTOUCHED (the bug this fixes)", () => {
    // Regression guard: the old cron read a nonexistent `lockExpiresAt`, so this
    // returned "expired" and wiped every live draft on each run.
    expect(sweepDecision("draft", FRESH, NOW)).toBeNull();
  });

  it("draft + no lock → swept (anomalous draft with no owner)", () => {
    expect(sweepDecision("draft", null, NOW)).toEqual({
      status: "not_started",
      lock: null,
    });
  });

  it("rejected + expired lock → release the lock but STAY rejected", () => {
    expect(sweepDecision("rejected", EXPIRED, NOW)).toEqual({ lock: null });
  });

  it("rejected + fresh lock → left untouched", () => {
    expect(sweepDecision("rejected", FRESH, NOW)).toBeNull();
  });

  it("rejected + no lock → left untouched (already clean)", () => {
    expect(sweepDecision("rejected", null, NOW)).toBeNull();
  });

  it("never sweeps approved / pending / not_started", () => {
    expect(sweepDecision("approved", EXPIRED, NOW)).toBeNull();
    expect(sweepDecision("pending", EXPIRED, NOW)).toBeNull();
    expect(sweepDecision("not_started", EXPIRED, NOW)).toBeNull();
  });
});

describe("expire-locks — cronAuthorized (fail-closed)", () => {
  it("rejects when CRON_SECRET is unset (old fail-open bug)", () => {
    expect(cronAuthorized(undefined, "Bearer anything")).toBe(false);
    expect(cronAuthorized("", "Bearer ")).toBe(false);
  });
  it("rejects a missing or wrong bearer token", () => {
    expect(cronAuthorized("s3cret", null)).toBe(false);
    expect(cronAuthorized("s3cret", "Bearer wrong")).toBe(false);
    expect(cronAuthorized("s3cret", "s3cret")).toBe(false);
  });
  it("accepts only the exact matching bearer token", () => {
    expect(cronAuthorized("s3cret", "Bearer s3cret")).toBe(true);
  });
});
