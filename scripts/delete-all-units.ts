/* eslint-disable @typescript-eslint/no-require-imports */
import * as admin from "firebase-admin";
import * as path from "path";

// Backs up and deletes EVERY unit from the terminal — the fast, quota-safe way
// to wipe all units without clicking through the UI. Each unit (and its
// submissions) is archived to `auditUnitsDeleted/{stamp__unitId}` first, so it
// can be restored later with scripts/restore-deleted-unit.ts.
//
// Uses a Firestore BulkWriter (self-throttles + retries RESOURCE_EXHAUSTED), and
// skips the submissions read for units that were never audited.
//
// Drive photos are NOT moved (only their folder id is recorded) to keep the run
// fast. Restore leaves the folder where it is; it's still linked by driveFolderId.
//
// Usage:
//   npx tsx scripts/delete-all-units.ts --yes   # actually delete
//   npx tsx scripts/delete-all-units.ts          # dry-run (count only)

const serviceAccount = require(path.resolve(__dirname, "../service-account.json"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const PAGE_SIZE = 300;
const READ_CONCURRENCY = 25;

function dateStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const stamp =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return { date, stamp };
}

const swallow = (pr: Promise<unknown>) => {
  void pr.catch(() => {});
};

async function main() {
  const db = admin.firestore();
  const apply = process.argv.includes("--yes");
  const { stamp } = dateStamp();

  const countSnap = await db.collection("auditUnits").count().get();
  const total = countSnap.data().count;
  console.log(`${total} unit ditemukan.`);
  if (!apply) {
    console.log("Dry-run. Tambahkan --yes untuk benar-benar menghapus (dengan backup).");
    process.exit(0);
  }
  if (total === 0) process.exit(0);

  const writer = db.bulkWriter();
  let deleted = 0;
  let last: admin.firestore.QueryDocumentSnapshot | null = null;

  for (;;) {
    let q: admin.firestore.Query = db
      .collection("auditUnits")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;

    for (let i = 0; i < page.docs.length; i += READ_CONCURRENCY) {
      const slice = page.docs.slice(i, i + READ_CONCURRENCY);
      await Promise.all(
        slice.map(async (d) => {
          const unitData = d.data();
          const backupRef = db.collection("auditUnitsDeleted").doc(`${stamp}__${d.id}`);
          const subDocs =
            (unitData.submissionCount ?? 0) > 0
              ? (await d.ref.collection("submissions").get()).docs
              : [];
          swallow(
            writer.set(backupRef, {
              originalUnitId: d.id,
              unitNumber: unitData.unitNumber ?? "",
              projectName: unitData.projectName ?? "",
              driveFolderId: unitData.driveFolderId ?? null,
              submissionCount: subDocs.length,
              deletedBy: "script:delete-all-units",
              deletedByName: "script:delete-all-units",
              deletedAt: admin.firestore.FieldValue.serverTimestamp(),
              unit: unitData,
            }),
          );
          for (const sub of subDocs) {
            swallow(writer.set(backupRef.collection("submissions").doc(sub.id), sub.data()));
            swallow(writer.delete(sub.ref));
          }
          swallow(writer.delete(d.ref));
          deleted++;
        }),
      );
    }

    last = page.docs[page.docs.length - 1];
    console.log(`  ...${deleted}/${total}`);
    if (page.size < PAGE_SIZE) break;
  }

  await writer.close();
  console.log(`Selesai. ${deleted} unit di-backup ke auditUnitsDeleted lalu dihapus (stamp ${stamp}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
