import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import {
  __setDbForTests,
  createSubmission,
  type NewSubmissionPayload,
} from "@/lib/audit-ar/firestore";
import type { AuditUnitDoc } from "@/lib/audit-ar/types";
import { authedDb, cleanupEnv, clearData, withoutRules } from "./helpers/emulator";

const UNIT = "unit-1";
const unitRef = (db: Firestore) => doc(db, "auditUnits", UNIT);
const subsCol = (db: Firestore) => collection(db, "auditUnits", UNIT, "submissions");

const payload: NewSubmissionPayload = {
  occupancyStatus: "occupied",
  pltExists: true,
  pltStatus: "exists",
  pltNotes: "",
  buildingConditionId: "bc-1",
  buildingConditionLabel: "Baik",
  buildingTypeId: "bt-1",
  buildingTypeLabel: "Ruko",
  remarks: "",
  attachments: [],
};

async function seedDraftLockedBy(uid: string) {
  await withoutRules(async (db) => {
    await setDoc(unitRef(db), {
      unitNumber: "A-101",
      unitNumberNorm: "A-101",
      status: "draft",
      currentSubmissionId: null,
      submissionCount: 0,
      lock: {
        lockedBy: uid,
        lockedByName: uid,
        lockedAt: Timestamp.now(),
        lockExpiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
}

// A realistic unit arg: the current (buggy) createSubmission reads unitNumber /
// submissionCount off this object, while the hardened version re-reads them fresh
// inside the transaction and only relies on `id`.
const asUnit = { id: UNIT, unitNumber: "A-101", submissionCount: 0 } as AuditUnitDoc;

describe("createSubmission — idempotent submit (Threat 1)", () => {
  afterEach(async () => {
    __setDbForTests(null);
    await clearData();
  });
  afterAll(cleanupEnv);

  it("a repeated submit for the same draft does not create a duplicate", async () => {
    await seedDraftLockedBy("auditor-a");
    __setDbForTests(await authedDb("auditor-a", { auditRole: "fieldAudit" }));

    const first = await createSubmission(asUnit, "auditor-a", "Auditor A", payload);
    expect(first.ok).toBe(true);

    const second = await createSubmission(asUnit, "auditor-a", "Auditor A", payload);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.reason).toBe("already_submitted");

    await withoutRules(async (db) => {
      const subs = await getDocs(subsCol(db));
      expect(subs.size).toBe(1);
      const u = (await getDoc(unitRef(db))).data();
      expect(u?.submissionCount).toBe(1);
      expect(u?.status).toBe("pending");
    });
  });

  it("two concurrent submits create exactly one submission", async () => {
    await seedDraftLockedBy("auditor-a");
    __setDbForTests(await authedDb("auditor-a", { auditRole: "fieldAudit" }));

    const [a, b] = await Promise.all([
      createSubmission(asUnit, "auditor-a", "Auditor A", payload),
      createSubmission(asUnit, "auditor-a", "Auditor A", payload),
    ]);

    expect([a, b].filter((r) => r?.ok === true).length).toBe(1);
    expect([a, b].filter((r) => r?.ok === false).length).toBe(1);

    await withoutRules(async (db) => {
      const subs = await getDocs(subsCol(db));
      expect(subs.size).toBe(1);
      const u = (await getDoc(unitRef(db))).data();
      expect(u?.submissionCount).toBe(1);
    });
  });

  it("rejects a submit from someone who does not hold the lock", async () => {
    await seedDraftLockedBy("auditor-b"); // held by another auditor
    __setDbForTests(await authedDb("auditor-a", { auditRole: "fieldAudit" }));

    const res = await createSubmission(asUnit, "auditor-a", "Auditor A", payload);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe("not_locked");

    await withoutRules(async (db) => {
      const subs = await getDocs(subsCol(db));
      expect(subs.size).toBe(0); // nothing written
    });
  });
});
