import {
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  writeBatch,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type QueryConstraint,
  type DocumentData,
} from "firebase/firestore";
import { getClientDb } from "@/lib/firebase/config";
import type {
  AuditUnitDoc,
  AuditSubmissionDoc,
  AuditAttachment,
  AuditCategoryDoc,
  AuditCategoryType,
  OccupancyStatus,
} from "./types";
import type { AuditUnitRow } from "./validators";
import { normalizeUnitNumber, unitIdFromNumber } from "./unit-id";

function db() {
  return getClientDb();
}

const BATCH_LIMIT = 500;
export const LOCK_TTL_MS = 15 * 60 * 1000; // 15 minutes

// ── Units (master data) ──

export async function getAuditUnits(constraints: QueryConstraint[] = []) {
  const q = query(collection(db(), "auditUnits"), ...constraints);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as AuditUnitDoc);
}

export async function getAuditUnit(unitId: string) {
  const snap = await getDoc(doc(db(), "auditUnits", unitId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as AuditUnitDoc) : null;
}

export interface UnitDiffEntry {
  row: AuditUnitRow;
  unitId: string;
  unitNumberNorm: string;
  isNew: boolean;
}

/**
 * Classify parsed rows as NEW vs UPDATE against existing units, by deterministic
 * unit ID. Reads existing docs in chunks of 10 (`documentId() in`).
 */
export async function diffUnitsAgainstExisting(
  rows: AuditUnitRow[],
): Promise<UnitDiffEntry[]> {
  const entries: UnitDiffEntry[] = rows.map((row) => ({
    row,
    unitId: unitIdFromNumber(row.unitNumber),
    unitNumberNorm: normalizeUnitNumber(row.unitNumber),
    isNew: true,
  }));

  const ids = Array.from(new Set(entries.map((e) => e.unitId)));
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const snap = await getDocs(
      query(collection(db(), "auditUnits"), where(documentId(), "in", chunk)),
    );
    snap.docs.forEach((d) => existing.add(d.id));
  }

  for (const e of entries) {
    e.isNew = !existing.has(e.unitId);
  }
  return entries;
}

/**
 * Upsert master-data rows. NEW units are fully initialized; UPDATE units only
 * overwrite the master-data fields (merge), preserving audit state, lock, drive
 * folder and the submissions subcollection.
 */
export async function batchUpsertAuditUnits(
  entries: UnitDiffEntry[],
  importBatchId: string,
) {
  for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
    const chunk = entries.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db());
    for (const e of chunk) {
      const ref = doc(db(), "auditUnits", e.unitId);
      const master = {
        unitNumber: e.row.unitNumber.trim(),
        unitNumberNorm: e.unitNumberNorm,
        projectName: e.row.projectName,
        unitDetail: e.row.unitDetail,
        customerName: e.row.customerName,
        brandName: e.row.brandName,
        unitType: e.row.unitType,
        concernNotes: e.row.concernNotes,
        importBatchId,
        updatedAt: serverTimestamp(),
      };
      if (e.isNew) {
        batch.set(ref, {
          ...master,
          status: "not_started",
          currentSubmissionId: null,
          lock: null,
          submissionCount: 0,
          lastSubmittedAt: null,
          lastReviewedAt: null,
          lastReviewedBy: null,
          lastRejectionNote: null,
          driveFolderId: null,
          createdAt: serverTimestamp(),
        });
      } else {
        // Preserve audit state — only master fields are merged in.
        batch.set(ref, master, { merge: true });
      }
    }
    await batch.commit();
  }
}

export async function createImportRecord(data: {
  importedBy: string;
  importedByName: string;
  fileName: string;
  newCount: number;
  updatedCount: number;
  skippedCount: number;
  totalRows: number;
}) {
  const ref = doc(collection(db(), "auditImports"));
  await setDoc(ref, { ...data, importedAt: serverTimestamp() });
  return ref.id;
}

export async function setUnitDriveFolder(unitId: string, driveFolderId: string) {
  await updateDoc(doc(db(), "auditUnits", unitId), {
    driveFolderId,
    updatedAt: serverTimestamp(),
  });
}

// ── Draft lock ──

export type AcquireLockResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "locked" | "status" | "error"; lockedByName?: string };

export async function acquireDraftLock(
  unitId: string,
  uid: string,
  userName: string,
): Promise<AcquireLockResult> {
  const ref = doc(db(), "auditUnits", unitId);
  try {
    return await runTransaction(db(), async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { ok: false, reason: "not_found" } as const;
      const data = snap.data() as AuditUnitDoc;
      const now = Date.now();
      const lock = data.lock;
      const heldByOther =
        !!lock && lock.lockedBy !== uid && lock.lockExpiresAt.toMillis() > now;
      if (heldByOther) {
        return { ok: false, reason: "locked", lockedByName: lock.lockedByName } as const;
      }
      if (!["not_started", "draft", "rejected"].includes(data.status)) {
        return { ok: false, reason: "status" } as const;
      }
      tx.update(ref, {
        status: data.status === "not_started" ? "draft" : data.status,
        lock: {
          lockedBy: uid,
          lockedByName: userName,
          lockedAt: serverTimestamp(),
          lockExpiresAt: Timestamp.fromMillis(now + LOCK_TTL_MS),
        },
        updatedAt: serverTimestamp(),
      });
      return { ok: true } as const;
    });
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** Heartbeat — extend the lock if still owned by this user. */
export async function renewDraftLock(unitId: string, uid: string): Promise<boolean> {
  const ref = doc(db(), "auditUnits", unitId);
  try {
    return await runTransaction(db(), async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return false;
      const data = snap.data() as AuditUnitDoc;
      if (!data.lock || data.lock.lockedBy !== uid) return false;
      tx.update(ref, {
        lock: {
          ...data.lock,
          lockExpiresAt: Timestamp.fromMillis(Date.now() + LOCK_TTL_MS),
        },
      });
      return true;
    });
  } catch {
    return false;
  }
}

/** Release a draft lock owned by this user; returns the unit to not_started if it was a fresh draft. */
export async function releaseDraftLock(unitId: string, uid: string): Promise<void> {
  const ref = doc(db(), "auditUnits", unitId);
  try {
    await runTransaction(db(), async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const data = snap.data() as AuditUnitDoc;
      if (!data.lock || data.lock.lockedBy !== uid) return;
      tx.update(ref, {
        lock: null,
        status: data.status === "draft" ? "not_started" : data.status,
        updatedAt: serverTimestamp(),
      });
    });
  } catch {
    // best-effort
  }
}

// ── Submissions (immutable history) ──

export interface NewSubmissionPayload {
  occupancyStatus: OccupancyStatus;
  pltExists: boolean;
  buildingConditionId: string;
  buildingConditionLabel: string;
  buildingTypeId: string;
  buildingTypeLabel: string;
  remarks: string;
  attachments: AuditAttachment[];
}

/**
 * Create a new immutable submission and flip the unit to pending. The caller must
 * hold the unit's draft lock (enforced by rules + the lock itself), so a plain
 * batch is sufficient — no concurrent submitter for the same unit.
 */
export async function createSubmission(
  unit: AuditUnitDoc,
  submittedBy: string,
  submittedByName: string,
  payload: NewSubmissionPayload,
): Promise<string> {
  const version = (unit.submissionCount ?? 0) + 1;
  const subRef = doc(collection(db(), "auditUnits", unit.id, "submissions"));
  const unitRef = doc(db(), "auditUnits", unit.id);

  const batch = writeBatch(db());
  batch.set(subRef, {
    unitId: unit.id,
    unitNumber: unit.unitNumber,
    version,
    status: "pending",
    submittedBy,
    submittedByName,
    submittedAt: serverTimestamp(),
    reviewedBy: null,
    reviewedByName: null,
    reviewedAt: null,
    rejectionNote: null,
    ...payload,
  });
  batch.update(unitRef, {
    status: "pending",
    currentSubmissionId: subRef.id,
    submissionCount: version,
    lastSubmittedAt: serverTimestamp(),
    lock: null,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return subRef.id;
}

export async function getSubmissions(unitId: string) {
  const snap = await getDocs(
    query(
      collection(db(), "auditUnits", unitId, "submissions"),
      orderBy("version", "desc"),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AuditSubmissionDoc);
}

export async function getSubmission(unitId: string, submissionId: string) {
  const snap = await getDoc(
    doc(db(), "auditUnits", unitId, "submissions", submissionId),
  );
  return snap.exists()
    ? ({ id: snap.id, ...snap.data() } as AuditSubmissionDoc)
    : null;
}

/** Supervisor approves or rejects the current submission. Rejection requires a note. */
export async function reviewSubmission(
  unit: AuditUnitDoc,
  submissionId: string,
  decision: "approved" | "rejected",
  reviewerUid: string,
  reviewerName: string,
  rejectionNote?: string,
): Promise<void> {
  const subRef = doc(db(), "auditUnits", unit.id, "submissions", submissionId);
  const unitRef = doc(db(), "auditUnits", unit.id);
  const batch = writeBatch(db());

  batch.update(subRef, {
    status: decision,
    reviewedBy: reviewerUid,
    reviewedByName: reviewerName,
    reviewedAt: serverTimestamp(),
    rejectionNote: decision === "rejected" ? rejectionNote ?? "" : null,
  });
  batch.update(unitRef, {
    status: decision,
    lastReviewedAt: serverTimestamp(),
    lastReviewedBy: reviewerUid,
    lastRejectionNote: decision === "rejected" ? rejectionNote ?? "" : null,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

// ── Categories ──

export async function getCategories(type?: AuditCategoryType) {
  const constraints: QueryConstraint[] = [orderBy("order", "asc")];
  if (type) constraints.unshift(where("type", "==", type));
  const snap = await getDocs(query(collection(db(), "auditCategories"), ...constraints));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AuditCategoryDoc);
}

export async function createCategory(type: AuditCategoryType, label: string, order: number) {
  const ref = doc(collection(db(), "auditCategories"));
  await setDoc(ref, {
    type,
    label,
    order,
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateCategory(
  id: string,
  data: Partial<Pick<AuditCategoryDoc, "label" | "order" | "isActive">>,
) {
  await updateDoc(doc(db(), "auditCategories", id), {
    ...data,
    updatedAt: serverTimestamp(),
  } as DocumentData);
}

// ── Cross-unit submission queries (review queue / dashboard) ──

export async function getSubmissionsByStatus(
  status: "pending" | "approved" | "rejected",
) {
  const snap = await getDocs(
    query(
      collectionGroup(db(), "submissions"),
      where("status", "==", status),
      orderBy("submittedAt", "desc"),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AuditSubmissionDoc);
}
