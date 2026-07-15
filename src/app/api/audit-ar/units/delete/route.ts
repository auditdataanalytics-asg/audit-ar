import { NextRequest, NextResponse } from "next/server";
import {
  FieldValue,
  type BulkWriter,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { moveFolderToBackup } from "@/lib/audit-ar/google/drive";

// Supervisor-only endpoint that deletes units. Every unit (and its immutable
// submissions subcollection) is copied to the `auditUnitsDeleted` archive
// BEFORE the originals are removed, so a developer can restore it later via
// scripts/restore-deleted-unit.ts. Clients cannot delete units directly
// (firestore.rules `allow delete: if false`) — this is the only path.
//
// Two-phase to guarantee "backup-before-delete": phase 1 writes+confirms every
// backup (a unit is only queued for deletion once its backup write resolves),
// phase 2 deletes the originals. So a unit is never destroyed without a
// recoverable copy, even if a write fails. All writes go through a Firestore
// BulkWriter (self-throttles via the 500/50/5 ramp + retries RESOURCE_EXHAUSTED
// with backoff), so a bulk delete never outruns Firestore's rate limit. Units
// that were never audited (submissionCount === 0) skip the submissions read.

const PAGE_SIZE = 300;
const READ_CONCURRENCY = 25; // bound concurrent unit-backup pipelines per page

function dateStamp(): { date: string; stamp: string } {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const stamp =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return { date, stamp };
}

interface DeleteMeta {
  deletedBy: string;
  deletedByName: string;
  date: string; // YYYY-MM-DD (Drive backup folder)
  stamp: string; // YYYYMMDD-HHMMSS (backup doc id prefix)
}

interface DeleteTarget {
  unitRef: DocumentReference;
  subRefs: DocumentReference[];
}

const swallow = (p: Promise<unknown>) => {
  // Phase-2 deletes are best-effort: a failed delete just leaves the (already
  // backed-up) unit in place, never data loss. Swallow so an abandoned op does
  // not surface as an unhandled rejection.
  void p.catch(() => {});
};

/**
 * Phase 1 — archive one unit + its submissions and AWAIT confirmation that the
 * backup writes landed. Returns the refs to delete in phase 2. Throws if the
 * backup fails, so the caller can skip deleting that unit.
 */
async function backupUnit(
  db: Firestore,
  writer: BulkWriter,
  unitId: string,
  unitData: DocumentData,
  meta: DeleteMeta,
): Promise<DeleteTarget> {
  const unitRef = db.collection("auditUnits").doc(unitId);
  const backupRef = db.collection("auditUnitsDeleted").doc(`${meta.stamp}__${unitId}`);

  const subDocs =
    (unitData.submissionCount ?? 0) > 0
      ? (await unitRef.collection("submissions").get()).docs
      : [];

  // Submissions archived as a subcollection so a long audit history never
  // approaches Firestore's 1 MB document limit.
  const writes: Promise<unknown>[] = [
    writer.set(backupRef, {
      originalUnitId: unitId,
      unitNumber: unitData.unitNumber ?? "",
      projectName: unitData.projectName ?? "",
      driveFolderId: unitData.driveFolderId ?? null,
      submissionCount: subDocs.length,
      deletedBy: meta.deletedBy,
      deletedByName: meta.deletedByName,
      deletedAt: FieldValue.serverTimestamp(),
      unit: unitData,
    }),
    ...subDocs.map((sub) =>
      writer.set(backupRef.collection("submissions").doc(sub.id), sub.data()),
    ),
  ];
  await Promise.all(writes); // rejects if any backup write ultimately fails

  return { unitRef, subRefs: subDocs.map((s) => s.ref) };
}

/** Phase 2 — schedule deletion of a unit's originals (submissions first, then the unit doc). */
function scheduleDelete(writer: BulkWriter, target: DeleteTarget) {
  for (const subRef of target.subRefs) swallow(writer.delete(subRef));
  swallow(writer.delete(target.unitRef));
}

/** Single-unit delete: backup (confirmed) → delete → best-effort Drive folder move. Returns false if the unit is gone. */
async function deleteOneUnit(
  db: Firestore,
  unitId: string,
  meta: DeleteMeta,
): Promise<boolean> {
  const snap = await db.collection("auditUnits").doc(unitId).get();
  if (!snap.exists) return false;
  const unitData = snap.data() as DocumentData;

  // Phase 1 — backup (throws if it fails, so we never reach the delete).
  const backupWriter = db.bulkWriter();
  const target = await backupUnit(db, backupWriter, unitId, unitData, meta);
  await backupWriter.close();

  // Phase 2 — delete originals.
  const deleteWriter = db.bulkWriter();
  scheduleDelete(deleteWriter, target);
  await deleteWriter.close();

  // Best-effort Drive archival (photos stay recoverable regardless: the folder
  // id is recorded in the backup doc).
  if (unitData.driveFolderId) {
    try {
      await moveFolderToBackup(
        unitData.driveFolderId as string,
        `${unitData.unitNumber ?? unitId}__${unitId}`,
        meta.date,
      );
    } catch {
      // Leave the folder in place; still recoverable via driveFolderId.
    }
  }
  return true;
}

/** Bulk delete every unit: back up + confirm all first, then delete only the confirmed ones. */
async function deleteAllUnits(db: Firestore, meta: DeleteMeta): Promise<number> {
  const backupWriter = db.bulkWriter();
  const targets: DeleteTarget[] = [];
  let last: QueryDocumentSnapshot | null = null;

  // Phase 1 — page every unit and back it up. All units still exist here, so
  // paging by document id advances cleanly.
  for (;;) {
    let q: Query = db.collection("auditUnits").orderBy("__name__").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;

    for (let i = 0; i < page.docs.length; i += READ_CONCURRENCY) {
      const slice = page.docs.slice(i, i + READ_CONCURRENCY);
      const results = await Promise.all(
        slice.map((d) =>
          backupUnit(db, backupWriter, d.id, d.data(), meta).catch(() => null),
        ),
      );
      for (const t of results) if (t) targets.push(t);
    }

    last = page.docs[page.docs.length - 1];
    if (page.size < PAGE_SIZE) break;
  }
  await backupWriter.close(); // every backup in `targets` is now committed

  // Phase 2 — delete only the units whose backup succeeded.
  const deleteWriter = db.bulkWriter();
  for (const t of targets) scheduleDelete(deleteWriter, t);
  await deleteWriter.close();

  return targets.length;
}

export async function POST(request: NextRequest) {
  try {
    const adminAuth = getAdminAuth();
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = await adminAuth.verifyIdToken(authHeader.split("Bearer ")[1]);

    const db = getAdminDb();
    const callerSnap = await db.collection("users").doc(decoded.uid).get();
    const callerAudit = callerSnap.data()?.modules?.auditAr;
    if (
      !callerSnap.exists ||
      !callerAudit?.enabled ||
      callerAudit.role !== "supervisor"
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      unitId?: string;
      all?: boolean;
    };
    const { date, stamp } = dateStamp();
    const meta: DeleteMeta = {
      deletedBy: decoded.uid,
      deletedByName:
        callerSnap.data()?.displayName ??
        callerSnap.data()?.email ??
        decoded.email ??
        "",
      date,
      stamp,
    };

    if (body.all) {
      const deleted = await deleteAllUnits(db, meta);
      return NextResponse.json({ deleted, backedUp: deleted });
    }

    if (!body.unitId) {
      return NextResponse.json({ error: "Missing unitId" }, { status: 400 });
    }
    const ok = await deleteOneUnit(db, body.unitId, meta);
    if (!ok) return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    return NextResponse.json({ deleted: 1, backedUp: 1 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 500 },
    );
  }
}
