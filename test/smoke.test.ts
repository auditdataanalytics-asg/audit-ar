import { afterAll, afterEach, describe, expect, it } from "vitest";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { __setDbForTests, getAuditUnit } from "@/lib/audit-ar/firestore";
import { authedDb, cleanupEnv, clearData, withoutRules } from "./helpers/emulator";

// Proves the harness end-to-end: emulator boots, rules load, the __setDbForTests
// seam injects an authenticated context, and a real data-layer function runs.
describe("harness smoke test", () => {
  afterEach(async () => {
    __setDbForTests(null);
    await clearData();
  });
  afterAll(cleanupEnv);

  it("reads a seeded unit through an authenticated fieldAudit context", async () => {
    await withoutRules(async (db) => {
      await setDoc(doc(db, "auditUnits", "unit-1"), {
        unitNumber: "A-101",
        unitNumberNorm: "A-101",
        status: "not_started",
        currentSubmissionId: null,
        lock: null,
        submissionCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    __setDbForTests(await authedDb("auditor-a", { auditRole: "fieldAudit" }));
    const unit = await getAuditUnit("unit-1");

    expect(unit).not.toBeNull();
    expect(unit?.unitNumber).toBe("A-101");
    expect(unit?.status).toBe("not_started");
  });
});
