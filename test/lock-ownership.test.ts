import { describe, it, expect } from "vitest";
import { LOCK_TTL_MS } from "@/lib/audit-ar/constants";
import { isLockOwnedLive } from "@/lib/audit-ar/lock-expiry";

// Pure-logic tests for the lock-ownership predicate that gates draft writes and
// submissions (Threat 3 root-cause guard). Runs under a plain `vitest run`.

const NOW = 1_700_000_000_000;
const FRESH = NOW - 60_000;
const EXPIRED = NOW - (LOCK_TTL_MS + 60_000);

describe("isLockOwnedLive (Threat 3 write guard)", () => {
  it("true when the caller owns a fresh lock", () => {
    expect(isLockOwnedLive("auditor-a", FRESH, "auditor-a", NOW)).toBe(true);
  });
  it("false when the caller's lock has expired", () => {
    expect(isLockOwnedLive("auditor-a", EXPIRED, "auditor-a", NOW)).toBe(false);
  });
  it("false when someone else owns the lock", () => {
    expect(isLockOwnedLive("auditor-b", FRESH, "auditor-a", NOW)).toBe(false);
  });
  it("false when there is no lock (owner/lockedAt absent)", () => {
    expect(isLockOwnedLive(null, null, "auditor-a", NOW)).toBe(false);
    expect(isLockOwnedLive(undefined, undefined, "auditor-a", NOW)).toBe(false);
  });
  it("false when the owner matches but lockedAt is missing", () => {
    expect(isLockOwnedLive("auditor-a", null, "auditor-a", NOW)).toBe(false);
  });
});
