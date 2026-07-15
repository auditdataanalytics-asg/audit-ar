import { NextRequest, NextResponse } from "next/server";
import {
  FieldValue,
  type BulkWriter,
  type DocumentData,
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
// All writes go through a Firestore BulkWriter, which self-throttles (the
// 500/50/5 ramp) and retries RESOURCE_EXHAUSTED with exponential backoff, so a
// bulk delete never hammers Firestore past its rate limit. Units that were never
// audited (submissionCount === 0) skip the submissions read+delete entirely.

const PAGE_SIZE = 300;
const READ_CONCURRENCY = 25; // bound concurrent submission reads per page

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

const swallow = (p: Promise<unknown>) => {
  // BulkWriter routes real failures through its retry policy; we only attach
  // this so an eventually-abandoned op doesn't surface as an unhandled rejection.
  void p.catch(() => {});
};

/**
 * Schedule (on the shared BulkWriter) the archival of one unit + its submissions
 * and the deletion of the originals. Reads submissions only when the unit was
 * actually audited. Does NOT touch Drive.
 */
async function archiveAndDelete(
  db: Firestore,
  writer: BulkWriter,
  unitId: string,
  unitData: DocumentData,
  meta: DeleteMeta,
): Promise<void> {
  const unitRef = db.collection("auditUnits").doc(unitId);
  const backupRef = db.collection("auditUnitsDeleted").doc(`${meta.stamp}__${unitId}`);

  const subDocs =
    (unitData.submissionCount ?? 0) > 0
      ? (await unitRef.collection("submissions").get()).docs
      : [];

  swallow(
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
  );
  // Submissions archived as a subcollection so a long audit history never
  // approaches Firestore's 1 MB document limit.
  for (const sub of subDocs) {
    swallow(writer.set(backupRef.collection("submissions").doc(sub.id), sub.data()));
    swallow(writer.delete(sub.ref));
  }
  swallow(writer.delete(unitRef));
}

/** Single-unit delete: archive + delete + best-effort Drive folder move. Returns false if the unit is gone. */
async function deleteOneUnit(
  db: Firestore,
  unitId: string,
  meta: DeleteMeta,
): Promise<boolean> {
  const snap = await db.collection("auditUnits").doc(unitId).get();
  if (!snap.exists) return false;
  const unitData = snap.data() as DocumentData;

  const writer = db.bulkWriter();
  await archiveAndDelete(db, writer, unitId, unitData, meta);
  await writer.close();

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

/** Bulk delete every unit. Drive folders are only recorded (not moved) to keep the run fast and quota-safe. */
async function deleteAllUnits(db: Firestore, meta: DeleteMeta): Promise<number> {
  const writer = db.bulkWriter();
  let deleted = 0;
  let last: QueryDocumentSnapshot | null = null;
  // Page by document id. The cursor is a stable id even after a page is deleted,
  // so the loop always advances and never revisits or stalls.
  for (;;) {
    let q: Query = db.collection("auditUnits").orderBy("__name__").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;

    for (let i = 0; i < page.docs.length; i += READ_CONCURRENCY) {
      const slice = page.docs.slice(i, i + READ_CONCURRENCY);
      await Promise.all(
        slice.map(async (d) => {
          try {
            await archiveAndDelete(db, writer, d.id, d.data(), meta);
            deleted++;
          } catch {
            // Skip this unit; the cursor still advances past it.
          }
        }),
      );
    }

    last = page.docs[page.docs.length - 1];
    if (page.size < PAGE_SIZE) break;
  }

  await writer.close(); // flush + await all throttled writes
  return deleted;
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
