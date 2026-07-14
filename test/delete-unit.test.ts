import { afterAll, afterEach, describe, it } from "vitest";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { assertFails } from "@firebase/rules-unit-testing";
import { __setDbForTests } from "@/lib/audit-ar/firestore";
import { authedDb, cleanupEnv, clearData, withoutRules } from "./helpers/emulator";

// Threat 5: a unit must never be destroyed from a client. All deletion goes
// through /api/audit-ar/units/delete (Admin SDK, bypasses rules), which archives
// the unit + its submissions to `auditUnitsDeleted` before removing the
// originals. These tests pin the rules that make the client path impossible —
// so nothing can be lost without the server-side backup running first. The
// backup/cascade behavior of the route itself is exercised by manual E2E
// verification (it runs under the Admin SDK, outside the rules harness).

const UNIT = "unit-del-1";
const SUB = "sub-1";
const FIELD = { auditRole: "fieldAudit" };
const SUPER = { auditRole: "supervisor" };

async function seedUnitWithSubmission() {
  await withoutRules(async (db) => {
    await setDoc(doc(db, "auditUnits", UNIT), {
      unitNumber: "A-101",
      unitNumberNorm: "A-101",
      projectName: "Proj",
      status: "approved",
      currentSubmissionId: SUB,
      submissionCount: 1,
      lock: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, "auditUnits", UNIT, "submissions", SUB), {
      unitId: UNIT,
      unitNumber: "A-101",
      version: 1,
      status: "approved",
      submittedBy: "auditor-a",
      submittedByName: "A",
      submittedAt: serverTimestamp(),
      reviewedBy: "sup-1",
      reviewedByName: "S",
      reviewedAt: serverTimestamp(),
      rejectionNote: null,
    });
  });
}

describe("delete unit — client can never delete; deletes go through the backup route (Threat 5)", () => {
  afterEach(async () => {
    __setDbForTests(null);
    await clearData();
  });
  afterAll(cleanupEnv);

  it("rules reject a fieldAudit client deleting a unit", async () => {
    await seedUnitWithSubmission();
    const db = await authedDb("auditor-a", FIELD);
    await assertFails(deleteDoc(doc(db, "auditUnits", UNIT)));
  });

  it("rules reject even a supervisor client deleting a unit (must use the Admin route)", async () => {
    await seedUnitWithSubmission();
    const db = await authedDb("sup-1", SUPER);
    await assertFails(deleteDoc(doc(db, "auditUnits", UNIT)));
  });

  it("rules reject deleting a submission from any client (history stays immutable)", async () => {
    await seedUnitWithSubmission();
    const db = await authedDb("sup-1", SUPER);
    await assertFails(deleteDoc(doc(db, "auditUnits", UNIT, "submissions", SUB)));
  });

  it("rules deny clients any access to the auditUnitsDeleted archive", async () => {
    const db = await authedDb("sup-1", SUPER);
    await assertFails(
      setDoc(doc(db, "auditUnitsDeleted", "x"), { originalUnitId: UNIT }),
    );
    await assertFails(getDoc(doc(db, "auditUnitsDeleted", "x")));
  });
});
