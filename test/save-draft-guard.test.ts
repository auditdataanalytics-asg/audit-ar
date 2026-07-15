import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
  type Firestore,
} from "firebase/firestore";
import { __setDbForTests, saveDraft, type DraftPayload } from "@/lib/audit-ar/firestore";
import { authedDb, cleanupEnv, clearData, withoutRules } from "./helpers/emulator";

// Threat 3 — the actual race, reproduced against the emulator: a photo upload that
// resolves AFTER submit must not resurrect a draft on the now-`pending` unit.
//
// NOTE: requires the Firestore emulator (Java) — run with `npm run test:emulator`.
// The decision logic is also covered emulator-free in test/lock-ownership.test.ts.

const UNIT = "unit-1";
const unitRef = (db: Firestore) => doc(db, "auditUnits", UNIT);
const FIELD = { auditRole: "fieldAudit" };

const DRAFT: DraftPayload = {
  occupancyStatus: "",
  pltStatus: "",
  pltNotes: "",
  buildingConditionId: "",
  buildingTypeId: "",
  remarks: "late upload",
  attachments: [],
};

async function readDraft() {
  let draft: unknown;
  await withoutRules(async (db) => {
    draft = (await getDoc(unitRef(db))).data()?.draft;
  });
  return draft;
}

describe("saveDraft lock guard (Threat 3)", () => {
  afterEach(async () => {
    __setDbForTests(null);
    await clearData();
  });
  afterAll(cleanupEnv);

  it("refuses to resurrect a draft on a submitted (pending, lock-less) unit", async () => {
    await withoutRules(async (db) => {
      await setDoc(unitRef(db), {
        unitNumber: "A-101",
        unitNumberNorm: "A-101",
        status: "pending", // already submitted
        currentSubmissionId: "sub-1",
        submissionCount: 1,
        lock: null, // submit cleared it
        draft: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    __setDbForTests(await authedDb("auditor-a", FIELD));
    const res = await saveDraft(UNIT, "auditor-a", DRAFT);

    expect(res).toEqual({ ok: false, reason: "not_locked" });
    expect((await readDraft()) ?? null).toBeNull(); // no draft resurrected
  });

  it("writes the draft when the caller still holds a live lock", async () => {
    await withoutRules(async (db) => {
      await setDoc(unitRef(db), {
        unitNumber: "A-101",
        unitNumberNorm: "A-101",
        status: "draft",
        currentSubmissionId: null,
        submissionCount: 0,
        lock: {
          lockedBy: "auditor-a",
          lockedByName: "A",
          lockedAt: Timestamp.now(),
        },
        draft: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    __setDbForTests(await authedDb("auditor-a", FIELD));
    const res = await saveDraft(UNIT, "auditor-a", DRAFT);

    expect(res.ok).toBe(true);
    expect((await readDraft() as { remarks?: string })?.remarks).toBe("late upload");
  });
});
