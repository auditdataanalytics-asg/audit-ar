import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  __setDbForTests,
  acquireDraftLock,
  renewDraftLock,
} from "@/lib/audit-ar/firestore";
import { authedDb, cleanupEnv, clearData, withoutRules } from "./helpers/emulator";

const UNIT = "unit-1";
const unitRef = (db: Firestore) => doc(db, "auditUnits", UNIT);
const FIELD = { auditRole: "fieldAudit" };
const SUPER = { auditRole: "supervisor" };

async function seedLocked(uid: string, lockedAtMs: number) {
  await withoutRules(async (db) => {
    await setDoc(unitRef(db), {
      unitNumber: "A-101",
      unitNumberNorm: "A-101",
      status: "draft",
      currentSubmissionId: null,
      submissionCount: 0,
      // Server-authoritative shape: lockedAt only, no lockExpiresAt.
      lock: { lockedBy: uid, lockedByName: uid, lockedAt: Timestamp.fromMillis(lockedAtMs) },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

async function seedFree() {
  await withoutRules(async (db) => {
    await setDoc(unitRef(db), {
      unitNumber: "A-101",
      unitNumberNorm: "A-101",
      status: "not_started",
      currentSubmissionId: null,
      submissionCount: 0,
      lock: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

async function readLock(): Promise<Record<string, unknown> | null | undefined> {
  let lock: Record<string, unknown> | null | undefined;
  await withoutRules(async (db) => {
    lock = (await getDoc(unitRef(db))).data()?.lock;
  });
  return lock;
}

describe("draft lock — server-authoritative validity (Threat 4)", () => {
  afterEach(async () => {
    __setDbForTests(null);
    await clearData();
  });
  afterAll(cleanupEnv);

  it("rules reject stealing a lock still held (fresh) by another auditor", async () => {
    await seedLocked("auditor-a", Date.now());
    const bDb = await authedDb("auditor-b", FIELD);
    await assertFails(
      updateDoc(unitRef(bDb), {
        lock: { lockedBy: "auditor-b", lockedByName: "B", lockedAt: serverTimestamp() },
        status: "draft",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("rules allow taking over a lock that has expired (server time)", async () => {
    await seedLocked("auditor-a", Date.now() - 20 * 60 * 1000);
    const bDb = await authedDb("auditor-b", FIELD);
    await assertSucceeds(
      updateDoc(unitRef(bDb), {
        lock: { lockedBy: "auditor-b", lockedByName: "B", lockedAt: serverTimestamp() },
        status: "draft",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("acquireDraftLock writes a server-anchored lock without lockExpiresAt", async () => {
    await seedFree();
    __setDbForTests(await authedDb("auditor-a", FIELD));
    const res = await acquireDraftLock(UNIT, "auditor-a", "Auditor A");
    expect(res.ok).toBe(true);
    const lock = await readLock();
    expect(lock?.lockedBy).toBe("auditor-a");
    expect(lock?.lockedAt).toBeDefined();
    expect(lock?.lockExpiresAt).toBeUndefined();
  });

  it("owner renew advances lockedAt (not a separate expiry field)", async () => {
    const t0 = Date.now() - 60_000;
    await seedLocked("auditor-a", t0);
    __setDbForTests(await authedDb("auditor-a", FIELD));
    const ok = await renewDraftLock(UNIT, "auditor-a");
    expect(ok).toBe(true);
    const lock = await readLock();
    expect((lock?.lockedAt as Timestamp).toMillis()).toBeGreaterThan(t0);
  });

  it("non-owner renew is a no-op and leaves the lock intact", async () => {
    await seedLocked("auditor-a", Date.now());
    __setDbForTests(await authedDb("auditor-b", FIELD));
    const ok = await renewDraftLock(UNIT, "auditor-b");
    expect(ok).toBe(false);
    const lock = await readLock();
    expect(lock?.lockedBy).toBe("auditor-a");
  });

  it("renew on a lock-less unit never creates a malformed (ownerless) lock", async () => {
    await seedFree();
    // A supervisor bypasses the field-audit lock rule, so pre-fix a blind renew
    // would create an ownerless { lockExpiresAt } lock here. Post-fix it must not.
    __setDbForTests(await authedDb("sup-1", SUPER));
    const ok = await renewDraftLock(UNIT, "sup-1");
    expect(ok).toBe(false);
    const lock = await readLock();
    expect(lock ?? null).toBeNull();
  });
});
