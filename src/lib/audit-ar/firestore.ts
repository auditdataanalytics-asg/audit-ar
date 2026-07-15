import {
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  writeBatch,
  runTransaction,
  serverTimestamp,
  type QueryConstraint,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import { getClientAuth, getClientDb } from "@/lib/firebase/config";
import { LOCK_TTL_MS } from "./constants";
import { isLockOwnedLive } from "./lock-expiry";
import type {
  AuditUnitDoc,
  AuditSubmissionDoc,
  AuditAttachment,
  AuditCategoryDoc,
  AuditCategoryType,
  OccupancyStatus,
  PltStatus,
} from "./types";
import type { AuditUnitRow } from "./validators";
import { normalizeUnitNumber, unitIdFromNumber } from "./unit-id";
import { canTransition } from "./status-machine";

// Test-only seam: emulator-backed Firestore instances are injected here so the
// data-layer functions can run against @firebase/rules-unit-testing contexts
// without changing production behavior. `null` in prod → real client DB.
let _dbOverride: Firestore | null = null;
export function __setDbForTests(instance: Firestore | null) {
  _dbOverride = instance;
}
function db() {
  return _dbOverride ?? getClientDb();
}

const BATCH_LIMIT = 500;
export { LOCK_TTL_MS };

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

/**
 * Live-subscribe to a single unit doc. Returns the unsubscribe fn. Used by the
 * field-audit form so a lock takeover / expiry sweep / clear is seen immediately
 * instead of being frozen at mount (Threat 5). Mirrors the onSnapshot + unsubscribe
 * pattern in use-auth.ts.
 */
export function subscribeAuditUnit(
  unitId: string,
  onNext: (unit: AuditUnitDoc | null) => void,
  onError?: (error: Error) => void,
): () => void {
  return onSnapshot(
    doc(db(), "auditUnits", unitId),
    (snap) => onNext(snap.exists() ? ({ id: snap.id, ...snap.data() } as AuditUnitDoc) : null),
    (error) => onError?.(error),
  );
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
        cluster: e.row.cluster,
        unitDetail: e.row.unitDetail,
        pelataranSistem: e.row.pelataranSistem,
        brandName: e.row.brandName,
        unitType: e.row.unitType,
        concernNotes: e.row.concernNotes,
        concernFlags: e.row.concernFlags,
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
      // Validity is judged from lockedAt + TTL (the same anchor the rules use with
      // server time). This client check is a courtesy; the rules are authoritative.
      const heldByOther =
        !!lock && lock.lockedBy !== uid && lock.lockedAt.toMillis() + LOCK_TTL_MS > now;
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
        },
        updatedAt: serverTimestamp(),
      });
      return { ok: true } as const;
    });
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * Heartbeat — push the lock's server-anchored `lockedAt` forward. Transactional
 * and ownership-checked so it can never resurrect a cleared lock into an ownerless
 * `{ lockedAt }` fragment (a supervisor bypasses the field-audit lock rule, so a
 * blind write here would otherwise create a phantom lock nobody can release).
 */
export async function renewDraftLock(unitId: string, uid: string): Promise<boolean> {
  const ref = doc(db(), "auditUnits", unitId);
  try {
    return await runTransaction(db(), async (tx) => {
      const snap = await tx.get(ref);
      const lock = snap.exists() ? (snap.data() as AuditUnitDoc).lock : null;
      if (!lock || lock.lockedBy !== uid) return false; // never renew a null/foreign lock
      tx.update(ref, { "lock.lockedAt": serverTimestamp() });
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

// ── Draft persistence (in-progress field-audit work) ──

export interface DraftPayload {
  occupancyStatus: OccupancyStatus | "";
  pltStatus: PltStatus | "";
  pltNotes: string;
  buildingConditionId: string;
  buildingTypeId: string;
  remarks: string;
  attachments: AuditAttachment[];
}

export type SaveDraftResult =
  | { ok: true }
  | { ok: false; reason: "not_locked" | "not_found" | "error" };

/**
 * Persist the in-progress draft (fields + uploaded photo refs) on the unit doc.
 *
 * Runs in a transaction gated on the caller still holding a live lock. This is the
 * root-cause guard for Threat 3: a photo upload that resolves *after* the unit was
 * submitted (lock + draft cleared, status now `pending`) must not resurrect a draft
 * on the submitted unit. Without the guard, a bare `updateDoc` would happily write
 * `draft` back — the field-audit security rule permits it because `pending` is an
 * allowed status and `lockOk` passes on a now-null lock.
 */
export async function saveDraft(
  unitId: string,
  uid: string,
  draft: DraftPayload,
): Promise<SaveDraftResult> {
  const ref = doc(db(), "auditUnits", unitId);
  try {
    return await runTransaction(db(), async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { ok: false, reason: "not_found" } as const;
      const lock = (snap.data() as AuditUnitDoc).lock;
      const owns = isLockOwnedLive(
        lock?.lockedBy,
        lock?.lockedAt?.toMillis(),
        uid,
        Date.now(),
      );
      if (!owns) return { ok: false, reason: "not_locked" } as const;
      tx.update(ref, {
        draft: { ...draft, updatedBy: uid, updatedAt: serverTimestamp() },
        updatedAt: serverTimestamp(),
      });
      return { ok: true } as const;
    });
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** Discard the draft: clear draft data + lock, and free a fresh draft back to not_started. */
export async function deleteDraft(unitId: string, uid: string): Promise<void> {
  const ref = doc(db(), "auditUnits", unitId);
  await runTransaction(db(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data() as AuditUnitDoc;
    if (data.lock && data.lock.lockedBy !== uid) return; // held by someone else
    tx.update(ref, {
      draft: null,
      lock: null,
      status: data.status === "draft" ? "not_started" : data.status,
      updatedAt: serverTimestamp(),
    });
  });
}

// ── Submissions (immutable history) ──

export interface NewSubmissionPayload {
  occupancyStatus: OccupancyStatus;
  pltExists: boolean;
  pltStatus: PltStatus;
  pltNotes: string;
  buildingConditionId: string;
  buildingConditionLabel: string;
  buildingTypeId: string;
  buildingTypeLabel: string;
  remarks: string;
  attachments: AuditAttachment[];
}

export type CreateSubmissionResult =
  | { ok: true; submissionId: string }
  | { ok: false; reason: "already_submitted" | "not_locked" | "not_found" | "error" };

/**
 * Create a new immutable submission and flip the unit to pending. Runs in a
 * transaction that re-reads the unit (the contended doc), so a repeated submit for
 * the same draft (double-tap / retry) finds the unit already `pending` and returns
 * `already_submitted` instead of creating a duplicate submission. The write itself
 * is still gated on the caller holding a live lock.
 */
export async function createSubmission(
  unit: AuditUnitDoc,
  submittedBy: string,
  submittedByName: string,
  payload: NewSubmissionPayload,
): Promise<CreateSubmissionResult> {
  const unitRef = doc(db(), "auditUnits", unit.id);
  // Generated once so a transaction retry reuses the same submission id.
  const subRef = doc(collection(db(), "auditUnits", unit.id, "submissions"));
  try {
    return await runTransaction(db(), async (tx) => {
      const snap = await tx.get(unitRef);
      if (!snap.exists()) return { ok: false, reason: "not_found" } as const;
      const data = snap.data() as AuditUnitDoc;
      // A duplicate submit sees the unit already `pending` here (draft|rejected ->
      // pending only). Checked before the lock so a benign double-tap — whose first
      // call already cleared the lock — reads as already_submitted, not not_locked.
      if (!canTransition(data.status, "pending", "fieldAudit")) {
        return { ok: false, reason: "already_submitted" } as const;
      }
      const lock = data.lock;
      const ownsLock =
        !!lock &&
        lock.lockedBy === submittedBy &&
        lock.lockedAt.toMillis() + LOCK_TTL_MS > Date.now();
      if (!ownsLock) return { ok: false, reason: "not_locked" } as const;

      const version = (data.submissionCount ?? 0) + 1;
      tx.set(subRef, {
        unitId: unit.id,
        unitNumber: data.unitNumber,
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
      tx.update(unitRef, {
        status: "pending",
        currentSubmissionId: subRef.id,
        submissionCount: version,
        lastSubmittedAt: serverTimestamp(),
        lock: null,
        draft: null,
        updatedAt: serverTimestamp(),
      });
      return { ok: true, submissionId: subRef.id } as const;
    });
  } catch {
    return { ok: false, reason: "error" };
  }
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

export type ReviewResult =
  | { ok: true }
  | { ok: false; reason: "already_reviewed" | "not_found" | "error" };

/**
 * Supervisor approves or rejects the current submission. Rejection requires a note.
 * Runs in a transaction that re-reads the submission and only proceeds while it is
 * still `pending`, so two supervisors (or a stale tab) cannot silently overwrite
 * each other's decision — the loser gets `already_reviewed`.
 */
export async function reviewSubmission(
  unit: AuditUnitDoc,
  submissionId: string,
  decision: "approved" | "rejected",
  reviewerUid: string,
  reviewerName: string,
  rejectionNote?: string,
): Promise<ReviewResult> {
  const subRef = doc(db(), "auditUnits", unit.id, "submissions", submissionId);
  const unitRef = doc(db(), "auditUnits", unit.id);
  try {
    return await runTransaction(db(), async (tx) => {
      const snap = await tx.get(subRef);
      if (!snap.exists()) return { ok: false, reason: "not_found" } as const;
      if ((snap.data() as AuditSubmissionDoc).status !== "pending") {
        return { ok: false, reason: "already_reviewed" } as const;
      }
      const note = decision === "rejected" ? rejectionNote ?? "" : null;
      tx.update(subRef, {
        status: decision,
        reviewedBy: reviewerUid,
        reviewedByName: reviewerName,
        reviewedAt: serverTimestamp(),
        rejectionNote: note,
      });
      tx.update(unitRef, {
        status: decision,
        lastReviewedAt: serverTimestamp(),
        lastReviewedBy: reviewerUid,
        lastRejectionNote: note,
        updatedAt: serverTimestamp(),
      });
      return { ok: true } as const;
    });
  } catch {
    return { ok: false, reason: "error" };
  }
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

// ── Unit deletion (supervisor-only, via Admin-SDK API route) ──
// Client cannot delete units directly (rules forbid it): all deletes go through
// /api/audit-ar/units/delete, which backs the unit + its submissions up to the
// `auditUnitsDeleted` archive before removing the originals. Restore is a
// developer-only script.

export interface DeleteUnitsResult {
  deleted: number;
  backedUp: number;
}

async function callDeleteApi(body: Record<string, unknown>): Promise<DeleteUnitsResult> {
  const currentUser = getClientAuth().currentUser;
  if (!currentUser) throw new Error("Tidak ada sesi login");
  const token = await currentUser.getIdToken();
  const res = await fetch("/api/audit-ar/units/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as
    | (DeleteUnitsResult & { error?: string })
    | { error?: string };
  if (!res.ok) throw new Error((data as { error?: string })?.error || "Gagal menghapus unit");
  return { deleted: (data as DeleteUnitsResult).deleted ?? 0, backedUp: (data as DeleteUnitsResult).backedUp ?? 0 };
}

export function deleteUnit(unitId: string): Promise<DeleteUnitsResult> {
  return callDeleteApi({ unitId });
}

export function deleteAllUnits(): Promise<DeleteUnitsResult> {
  return callDeleteApi({ all: true });
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
