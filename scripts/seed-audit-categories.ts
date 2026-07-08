/* eslint-disable @typescript-eslint/no-require-imports */
import * as admin from "firebase-admin";
import * as path from "path";

// Seeds dummy Audit AR categories (building condition / building type) so the
// field-audit form is testable. Idempotent: skips labels that already exist.
//
// Usage: npx tsx scripts/seed-audit-categories.ts

const serviceAccount = require(path.resolve(__dirname, "../service-account.json"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const CONDITIONS = ["Baik", "Rusak Ringan", "Rusak Berat", "Dalam Renovasi"];
const TYPES = ["Ruko", "Rumah Tinggal", "Kavling Tanah", "Gudang", "Kantor"];

async function seed() {
  const db = admin.firestore();

  const existingSnap = await db.collection("auditCategories").get();
  const existing = new Set(
    existingSnap.docs.map((d) => `${d.data().type}|${d.data().label}`),
  );

  const batch = db.batch();
  let added = 0;

  const add = (type: "buildingCondition" | "buildingType", labels: string[]) => {
    labels.forEach((label, i) => {
      if (existing.has(`${type}|${label}`)) return;
      const ref = db.collection("auditCategories").doc();
      batch.set(ref, {
        type,
        label,
        order: i,
        isActive: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      added++;
    });
  };

  add("buildingCondition", CONDITIONS);
  add("buildingType", TYPES);

  if (added > 0) await batch.commit();
  console.log(`Seeded ${added} new categories (skipped ${existing.size} existing).`);
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
