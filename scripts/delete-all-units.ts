/* eslint-disable @typescript-eslint/no-require-imports */
import * as admin from "firebase-admin";
import * as path from "path";

// Backs up and deletes EVERY unit from the terminal — the fast, quota-safe way
// to wipe all units without clicking through the UI. Two-phase so a unit is
// never deleted without a committed backup: phase 1 archives every unit to
// `auditUnitsDeleted/{stamp__unitId}` (a unit only enters the delete list once
// its backup write resolves), phase 2 deletes the confirmed originals. Restore
// later with scripts/restore-deleted-unit.ts.
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

type Ref = admin.firestore.DocumentReference;
interface DeleteTarget {
  unitRef: Ref;
  subRefs: Ref[];
}

function dateStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return stamp;
}

async function backupUnit(
  db: admin.firestore.Firestore,
  writer: admin.firestore.BulkWriter,
  d: admin.firestore.QueryDocumentSnapshot,
  stamp: string,
): Promise<DeleteTarget> {
  const unitData = d.data();
  const backupRef = db.collection("auditUnitsDeleted").doc(`${stamp}__${d.id}`);
  const subDocs =
    (unitData.submissionCount ?? 0) > 0
      ? (await d.ref.collection("submissions").get()).docs
      : [];

  const writes: Promise<unknown>[] = [
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
    ...subDocs.map((sub) =>
      writer.set(backupRef.collection("submissions").doc(sub.id), sub.data()),
    ),
  ];
  await Promise.all(writes); // rejects if any backup write ultimately fails

  return { unitRef: d.ref, subRefs: subDocs.map((s) => s.ref) };
}

async function main() {
  const db = admin.firestore();
  const apply = process.argv.includes("--yes");
  const stamp = dateStamp();

  const total = (await db.collection("auditUnits").count().get()).data().count;
  console.log(`${total} unit ditemukan.`);
  if (!apply) {
    console.log("Dry-run. Tambahkan --yes untuk benar-benar menghapus (dengan backup).");
    process.exit(0);
  }
  if (total === 0) process.exit(0);

  // Phase 1 — back up every unit and confirm.
  const backupWriter = db.bulkWriter();
  const targets: DeleteTarget[] = [];
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
      const results = await Promise.all(
        slice.map((d) => backupUnit(db, backupWriter, d, stamp).catch(() => null)),
      );
      for (const t of results) if (t) targets.push(t);
    }
    last = page.docs[page.docs.length - 1];
    console.log(`  backup ...${targets.length}/${total}`);
    if (page.size < PAGE_SIZE) break;
  }
  await backupWriter.close();
  console.log(`Backup selesai: ${targets.length} unit ter-arsip. Menghapus...`);

  // Phase 2 — delete only the units whose backup succeeded.
  const deleteWriter = db.bulkWriter();
  for (const t of targets) {
    for (const subRef of t.subRefs) void deleteWriter.delete(subRef).catch(() => {});
    void deleteWriter.delete(t.unitRef).catch(() => {});
  }
  await deleteWriter.close();

  console.log(`Selesai. ${targets.length} unit di-backup ke auditUnitsDeleted lalu dihapus (stamp ${stamp}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
