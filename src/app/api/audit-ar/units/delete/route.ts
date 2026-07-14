import { NextRequest, NextResponse } from "next/server";
import {
  FieldValue,
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

const SUB_DELETE_CHUNK = 400;
const PAGE_SIZE = 300;
const DELETE_ALL_CONCURRENCY = 8;

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
  moveDrive: boolean; // single delete moves the Drive folder; bulk only records it
}

/** Archive one unit + its submissions, then delete the originals. Returns false if the unit is gone. */
async function backupAndDeleteUnit(
  db: Firestore,
  unitId: string,
  meta: DeleteMeta,
): Promise<boolean> {
  const unitRef = db.collection("auditUnits").doc(unitId);
  const unitSnap = await unitRef.get();
  if (!unitSnap.exists) return false;
  const unitData = unitSnap.data() as DocumentData;

  const subsSnap = await unitRef.collection("submissions").get();

  const backupRef = db.collection("auditUnitsDeleted").doc(`${meta.stamp}__${unitId}`);
  const backupBatch = db.batch();
  backupBatch.set(backupRef, {
    originalUnitId: unitId,
    unitNumber: unitData.unitNumber ?? "",
    projectName: unitData.projectName ?? "",
    driveFolderId: unitData.driveFolderId ?? null,
    submissionCount: subsSnap.size,
    deletedBy: meta.deletedBy,
    deletedByName: meta.deletedByName,
    deletedAt: FieldValue.serverTimestamp(),
    unit: unitData,
  });
  // Store submissions as a subcollection so a unit with a long audit history
  // never approaches Firestore's 1 MB document limit.
  subsSnap.docs.forEach((d) => {
    backupBatch.set(backupRef.collection("submissions").doc(d.id), d.data());
  });
  await backupBatch.commit();

  // Best-effort Drive archival (photos are preserved regardless: the folder id
  // is recorded in the backup doc above).
  if (meta.moveDrive && unitData.driveFolderId) {
    try {
      await moveFolderToBackup(
        unitData.driveFolderId as string,
        `${unitData.unitNumber ?? unitId}__${unitId}`,
        meta.date,
      );
    } catch {
      // Leave the folder in place; it's still recoverable via driveFolderId.
    }
  }

  // Delete originals: submissions (chunked ≤500/batch), then the unit doc.
  for (let i = 0; i < subsSnap.docs.length; i += SUB_DELETE_CHUNK) {
    const batch = db.batch();
    subsSnap.docs.slice(i, i + SUB_DELETE_CHUNK).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await unitRef.delete();
  return true;
}

async function deleteAllUnits(db: Firestore, meta: DeleteMeta): Promise<number> {
  let deleted = 0;
  let last: QueryDocumentSnapshot | null = null;
  // Page by document id. The cursor advances even past units that fail, so one
  // bad unit can't stall the whole run or cause an infinite loop.
  for (;;) {
    let q: Query = db.collection("auditUnits").orderBy("__name__").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;

    for (let i = 0; i < page.docs.length; i += DELETE_ALL_CONCURRENCY) {
      const slice = page.docs.slice(i, i + DELETE_ALL_CONCURRENCY);
      const results = await Promise.all(
        slice.map((d) =>
          backupAndDeleteUnit(db, d.id, meta).catch(() => false),
        ),
      );
      deleted += results.filter(Boolean).length;
    }

    last = page.docs[page.docs.length - 1];
    if (page.size < PAGE_SIZE) break;
  }
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
    const deletedByName =
      callerSnap.data()?.displayName ??
      callerSnap.data()?.email ??
      decoded.email ??
      "";
    const baseMeta = { deletedBy: decoded.uid, deletedByName, date, stamp };

    if (body.all) {
      const deleted = await deleteAllUnits(db, { ...baseMeta, moveDrive: false });
      return NextResponse.json({ deleted, backedUp: deleted });
    }

    if (!body.unitId) {
      return NextResponse.json({ error: "Missing unitId" }, { status: 400 });
    }
    const ok = await backupAndDeleteUnit(db, body.unitId, {
      ...baseMeta,
      moveDrive: true,
    });
    if (!ok) return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    return NextResponse.json({ deleted: 1, backedUp: 1 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 500 },
    );
  }
}
