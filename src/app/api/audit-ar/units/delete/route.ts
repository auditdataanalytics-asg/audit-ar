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

// Supervisor-only endpoint that deletes units. Every unit (and its immutable
// submissions subcollection) is copied to the `auditUnitsDeleted` archive
// BEFORE the originals are removed, so a developer can restore it later via
// scripts/restore-deleted-unit.ts. Clients cannot delete units directly
// (firestore.rules `allow delete: if false`) — this is the only path.
//
// Two-phase guarantees "backup-before-delete": every backup write is confirmed
// before its unit is deleted, so a unit is never destroyed without a recoverable
// copy. Google Drive photos are intentionally NOT touched here (only their folder
// id is recorded in the backup) — moving folders added 5-8 blocking Drive API
// calls per unit and a heavy client import, which made deletes slow. Photos stay
// in place and remain recoverable via the recorded driveFolderId.

const PAGE_SIZE = 300;
const READ_CONCURRENCY = 25; // bound concurrent unit-backup pipelines per page
const BATCH_LIMIT = 450; // < 500 Firestore batch cap, headroom for safety

function stamp(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

interface DeleteMeta {
  deletedBy: string;
  deletedByName: string;
  stamp: string; // YYYYMMDD-HHMMSS (backup doc id prefix)
}

type WriteOp =
  | { kind: "set"; ref: DocumentReference; data: DocumentData }
  | { kind: "delete"; ref: DocumentReference };

async function commitInChunks(db: Firestore, ops: WriteOp[]): Promise<void> {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + BATCH_LIMIT)) {
      if (op.kind === "set") batch.set(op.ref, op.data);
      else batch.delete(op.ref);
    }
    await batch.commit();
  }
}

function backupDoc(unitId: string, unitData: DocumentData, subCount: number, meta: DeleteMeta) {
  return {
    originalUnitId: unitId,
    unitNumber: unitData.unitNumber ?? "",
    projectName: unitData.projectName ?? "",
    driveFolderId: unitData.driveFolderId ?? null,
    submissionCount: subCount,
    deletedBy: meta.deletedBy,
    deletedByName: meta.deletedByName,
    deletedAt: FieldValue.serverTimestamp(),
    unit: unitData,
  };
}

/** Single-unit delete via plain batches (no BulkWriter, no Drive): backup (confirmed) → delete. Returns false if the unit is gone. */
async function deleteOneUnit(
  db: Firestore,
  unitId: string,
  meta: DeleteMeta,
): Promise<boolean> {
  const unitRef = db.collection("auditUnits").doc(unitId);
  const snap = await unitRef.get();
  if (!snap.exists) return false;
  const unitData = snap.data() as DocumentData;

  const subDocs =
    (unitData.submissionCount ?? 0) > 0
      ? (await unitRef.collection("submissions").get()).docs
      : [];
  const backupRef = db.collection("auditUnitsDeleted").doc(`${meta.stamp}__${unitId}`);

  // Phase 1 — backup, committed & confirmed before any delete.
  await commitInChunks(db, [
    { kind: "set", ref: backupRef, data: backupDoc(unitId, unitData, subDocs.length, meta) },
    ...subDocs.map((s) => ({
      kind: "set" as const,
      ref: backupRef.collection("submissions").doc(s.id),
      data: s.data(),
    })),
  ]);

  // Phase 2 — delete originals (submissions we already read, then the unit).
  await commitInChunks(db, [
    ...subDocs.map((s) => ({ kind: "delete" as const, ref: s.ref })),
    { kind: "delete" as const, ref: unitRef },
  ]);

  return true;
}

interface DeleteTarget {
  unitRef: DocumentReference;
  subRefs: DocumentReference[];
}

const swallow = (p: Promise<unknown>) => {
  // Phase-2 bulk deletes are best-effort: a failed delete leaves the (already
  // backed-up) unit in place — never data loss. Swallow to avoid unhandled rejections.
  void p.catch(() => {});
};

/**
 * Phase 1 (bulk) — archive one unit + its submissions on the shared BulkWriter
 * and AWAIT that the backup writes landed. Throws on backup failure so the
 * caller can skip deleting that unit.
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

  const writes: Promise<unknown>[] = [
    writer.set(backupRef, backupDoc(unitId, unitData, subDocs.length, meta)),
    ...subDocs.map((sub) =>
      writer.set(backupRef.collection("submissions").doc(sub.id), sub.data()),
    ),
  ];
  await Promise.all(writes); // rejects if any backup write ultimately fails

  return { unitRef, subRefs: subDocs.map((s) => s.ref) };
}

function scheduleDelete(writer: BulkWriter, target: DeleteTarget) {
  for (const subRef of target.subRefs) swallow(writer.delete(subRef));
  swallow(writer.delete(target.unitRef));
}

/** Bulk delete every unit: back up + confirm all first, then delete only the confirmed ones. */
async function deleteAllUnits(db: Firestore, meta: DeleteMeta): Promise<number> {
  const backupWriter = db.bulkWriter();
  const targets: DeleteTarget[] = [];
  let last: QueryDocumentSnapshot | null = null;

  // Phase 1 — page every unit and back it up (all still exist while paging).
  for (;;) {
    let q: Query = db.collection("auditUnits").orderBy("__name__").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;

    for (let i = 0; i < page.docs.length; i += READ_CONCURRENCY) {
      const slice = page.docs.slice(i, i + READ_CONCURRENCY);
      const results = await Promise.all(
        slice.map((d) => backupUnit(db, backupWriter, d.id, d.data(), meta).catch(() => null)),
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
    const meta: DeleteMeta = {
      deletedBy: decoded.uid,
      deletedByName:
        callerSnap.data()?.displayName ??
        callerSnap.data()?.email ??
        decoded.email ??
        "",
      stamp: stamp(),
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
