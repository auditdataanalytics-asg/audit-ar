import { afterAll, afterEach, describe, expect, it } from "vitest";
import { collection, doc, writeBatch } from "firebase/firestore";

import {
  __setDbForTests,
  getAuditUnitsNumberedPageFromFirestore,
} from "@/lib/audit-ar/firestore";
import { authedDb, cleanupEnv, clearData, withoutRules } from "./helpers/emulator";

describe("numbered unit pages", () => {
  afterEach(async () => {
    __setDbForTests(null);
    await clearData();
  });
  afterAll(cleanupEnv);

  it("loads only the requested rows and reports the filtered total", async () => {
    await withoutRules(async (db) => {
      const batch = writeBatch(db);
      for (let index = 1; index <= 120; index += 1) {
        const unitNumber = `UNIT-${String(index).padStart(3, "0")}`;
        batch.set(doc(collection(db, "auditUnits")), {
          unitNumber,
          unitNumberNorm: unitNumber,
          projectName: "TEST",
          status: index <= 80 ? "not_started" : "pending",
          submissionCount: 0,
        });
      }
      await batch.commit();
    });

    __setDbForTests(await authedDb("supervisor-a", { auditRole: "supervisor" }));
    const result = await getAuditUnitsNumberedPageFromFirestore({
      page: 2,
      pageSize: 50,
      statusFilter: "all",
    });

    expect(result.total).toBe(120);
    expect(result.totalPages).toBe(3);
    expect(result.units).toHaveLength(50);
    expect(result.units[0]?.unitNumber).toBe("UNIT-051");
    expect(result.units[49]?.unitNumber).toBe("UNIT-100");
  });

  it("applies status and unit-number prefix filters", async () => {
    await withoutRules(async (db) => {
      const batch = writeBatch(db);
      for (const [unitNumber, status] of [
        ["CGA-001", "not_started"],
        ["CGA-002", "pending"],
        ["BGM-001", "pending"],
      ]) {
        batch.set(doc(collection(db, "auditUnits")), {
          unitNumber,
          unitNumberNorm: unitNumber,
          projectName: "TEST",
          status,
          submissionCount: 0,
        });
      }
      await batch.commit();
    });

    __setDbForTests(await authedDb("supervisor-a", { auditRole: "supervisor" }));
    const result = await getAuditUnitsNumberedPageFromFirestore({
      search: "cga",
      statusFilter: "pending",
      pageSize: 10,
    });

    expect(result.total).toBe(1);
    expect(result.units.map((unit) => unit.unitNumber)).toEqual(["CGA-002"]);
  });
});
