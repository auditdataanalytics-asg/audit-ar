import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { assertFails } from "@firebase/rules-unit-testing";
import { __setDbForTests, reviewSubmission } from "@/lib/audit-ar/firestore";
import type { AuditUnitDoc } from "@/lib/audit-ar/types";
import { authedDb, cleanupEnv, clearData, withoutRules } from "./helpers/emulator";

const UNIT = "unit-1";
const SUB = "sub-1";
const unitRef = (db: Firestore) => doc(db, "auditUnits", UNIT);
const subRef = (db: Firestore) => doc(db, "auditUnits", UNIT, "submissions", SUB);

async function seedPending() {
  await withoutRules(async (db) => {
    await setDoc(unitRef(db), {
      unitNumber: "A-101",
      unitNumberNorm: "A-101",
      status: "pending",
      currentSubmissionId: SUB,
      submissionCount: 1,
      lock: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await setDoc(subRef(db), {
      unitId: UNIT,
      unitNumber: "A-101",
      version: 1,
      status: "pending",
      submittedBy: "auditor-a",
      submittedByName: "Auditor A",
      submittedAt: serverTimestamp(),
      reviewedBy: null,
      reviewedByName: null,
      reviewedAt: null,
      rejectionNote: null,
    });
  });
}

const asUnit = { id: UNIT } as AuditUnitDoc;

describe("reviewSubmission — concurrency + status guard (Threat 2)", () => {
  afterEach(async () => {
    __setDbForTests(null);
    await clearData();
  });
  afterAll(cleanupEnv);

  it("does not silently overwrite an already-reviewed submission", async () => {
    await seedPending();
    __setDbForTests(await authedDb("sup-1", { auditRole: "supervisor" }));

    const first = await reviewSubmission(asUnit, SUB, "approved", "sup-1", "Sup One");
    expect(first.ok).toBe(true);

    const second = await reviewSubmission(asUnit, SUB, "rejected", "sup-2", "Sup Two", "no good");
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.reason).toBe("already_reviewed");

    await withoutRules(async (db) => {
      const s = (await getDoc(subRef(db))).data();
      expect(s?.status).toBe("approved"); // first decision preserved
      expect(s?.reviewedBy).toBe("sup-1");
    });
  });

  it("serializes two concurrent reviews — exactly one wins", async () => {
    await seedPending();
    __setDbForTests(await authedDb("sup-1", { auditRole: "supervisor" }));

    const [a, b] = await Promise.all([
      reviewSubmission(asUnit, SUB, "approved", "sup-1", "Sup One"),
      reviewSubmission(asUnit, SUB, "rejected", "sup-2", "Sup Two", "bad"),
    ]);

    const oks = [a, b].filter((r) => r?.ok === true);
    const losers = [a, b].filter((r) => r?.ok === false);
    // Exactly one review wins; the other loses without overwriting. The loser's
    // reason is `already_reviewed` (clean retry) or `error` (the emulator surfaces
    // transaction contention as an abort) — either way it did not win.
    expect(oks.length).toBe(1);
    expect(losers.length).toBe(1);

    // Strong invariant: the winner's decision is the only one that took effect, and
    // the unit's denormalized status matches its submission.
    const winnerDecision = a?.ok ? "approved" : "rejected";
    await withoutRules(async (db) => {
      const s = (await getDoc(subRef(db))).data();
      const u = (await getDoc(unitRef(db))).data();
      expect(s?.status).toBe(winnerDecision);
      expect(u?.status).toBe(winnerDecision);
    });
  });

  it("security rules reject reviewing a non-pending submission", async () => {
    await seedPending();
    await withoutRules(async (db) => {
      await updateDoc(subRef(db), { status: "approved" });
    });

    const superDb = await authedDb("sup-1", { auditRole: "supervisor" });
    await assertFails(
      updateDoc(subRef(superDb), {
        status: "rejected",
        reviewedBy: "sup-1",
        reviewedByName: "Sup One",
        reviewedAt: serverTimestamp(),
        rejectionNote: "late",
      }),
    );
  });
});
