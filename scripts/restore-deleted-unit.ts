/* eslint-disable @typescript-eslint/no-require-imports */
import * as admin from "firebase-admin";
import * as path from "path";

// Restores a unit that was deleted through /api/audit-ar/units/delete. Deleted
// units (and their submissions) are archived under `auditUnitsDeleted/{backupId}`
// before removal; this script writes them back to `auditUnits`.
//
// Photos: if the Drive folder was moved to AuditAR/_Deleted/{date}, move it back
// manually in Drive — the folder id is printed below. The unit keeps its
// original driveFolderId, so links keep working once the folder is restored.
//
// Usage:
//   npx tsx scripts/restore-deleted-unit.ts            # list available backups
//   npx tsx scripts/restore-deleted-unit.ts <backupId> # restore one backup

const serviceAccount = require(path.resolve(__dirname, "../service-account.json"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const BATCH_LIMIT = 400;

async function listBackups(db: admin.firestore.Firestore) {
  const snap = await db
    .collection("auditUnitsDeleted")
    .orderBy("deletedAt", "desc")
    .limit(50)
    .get();
  if (snap.empty) {
    console.log("No backups found in `auditUnitsDeleted`.");
    return;
  }
  console.log(`Latest ${snap.size} backup(s):\n`);
  for (const d of snap.docs) {
    const x = d.data();
    const when =
      x.deletedAt?.toDate?.().toISOString?.() ?? String(x.deletedAt ?? "-");
    console.log(
      `  ${d.id}\n    unit=${x.unitNumber ?? "-"}  submissions=${x.submissionCount ?? 0}  by=${x.deletedByName ?? x.deletedBy}  at=${when}`,
    );
  }
  console.log("\nRestore with: npx tsx scripts/restore-deleted-unit.ts <backupId>");
}

async function restore(db: admin.firestore.Firestore, backupId: string) {
  const backupRef = db.collection("auditUnitsDeleted").doc(backupId);
  const backupSnap = await backupRef.get();
  if (!backupSnap.exists) {
    console.error(`Backup ${backupId} not found.`);
    process.exit(1);
  }
  const data = backupSnap.data()!;
  const originalUnitId: string = data.originalUnitId;
  const unitData = data.unit as admin.firestore.DocumentData;

  const unitRef = db.collection("auditUnits").doc(originalUnitId);
  if ((await unitRef.get()).exists) {
    console.error(
      `Unit ${originalUnitId} already exists — refusing to overwrite. Delete it first if you really want to restore.`,
    );
    process.exit(1);
  }

  // Restore the unit document.
  await unitRef.set(unitData);

  // Restore submissions from the backup subcollection.
  const subsSnap = await backupRef.collection("submissions").get();
  for (let i = 0; i < subsSnap.docs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    subsSnap.docs.slice(i, i + BATCH_LIMIT).forEach((d) => {
      batch.set(unitRef.collection("submissions").doc(d.id), d.data());
    });
    await batch.commit();
  }

  console.log(
    `Restored unit ${unitData.unitNumber ?? originalUnitId} (${originalUnitId}) with ${subsSnap.size} submission(s).`,
  );
  if (data.driveFolderId) {
    console.log(
      `Drive folder id: ${data.driveFolderId} — if it was moved to AuditAR/_Deleted, move it back in Drive.`,
    );
  }
  console.log(
    `The backup at auditUnitsDeleted/${backupId} was kept. Delete it manually when you're sure.`,
  );
  process.exit(0);
}

async function main() {
  const db = admin.firestore();
  const backupId = process.argv[2];
  if (!backupId) {
    await listBackups(db);
    process.exit(0);
  }
  await restore(db, backupId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
