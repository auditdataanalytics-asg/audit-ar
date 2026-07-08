import { Timestamp } from "firebase/firestore";

// ── Roles & access (independent of LMS role) ──

export type AuditRole = "supervisor" | "fieldAudit";

export const AUDIT_ROLES: AuditRole[] = ["supervisor", "fieldAudit"];

export interface AuditArAccess {
  enabled: boolean;
  role: AuditRole | null;
  grantedAt: Timestamp;
  grantedBy: string; // uid of granter
}

// ── Status lifecycle ──

export type UnitAuditStatus =
  | "not_started"
  | "draft"
  | "pending"
  | "approved"
  | "rejected";

export const UNIT_AUDIT_STATUSES: UnitAuditStatus[] = [
  "not_started",
  "draft",
  "pending",
  "approved",
  "rejected",
];

export type AuditSubmissionStatus = "pending" | "approved" | "rejected";

export type OccupancyStatus = "occupied" | "not_occupied";

export type PltStatus = "exists" | "not_exists" | "other";

export const PLT_STATUS_LABELS: Record<PltStatus, string> = {
  exists: "Ada PLT",
  not_exists: "Tidak ada PLT",
  other: "Lainnya",
};

export function formatPltStatus(
  status: PltStatus | undefined,
  notes?: string | null,
  fallbackExists?: boolean,
): string {
  if (status === "other") {
    const detail = notes?.trim();
    return detail ? `Lainnya: ${detail}` : "Lainnya";
  }
  if (status) return PLT_STATUS_LABELS[status];
  if (fallbackExists === undefined) return "-";
  return fallbackExists ? "Ada PLT" : "Tidak ada PLT";
}

// ── Draft lock ──

export interface AuditLock {
  lockedBy: string; // field-audit uid
  lockedByName: string; // denormalized display name
  lockedAt: Timestamp;
  lockExpiresAt: Timestamp; // heartbeat TTL window
}

// ── Master-data unit ──

export interface AuditUnitDoc {
  id: string; // slugged+hashed unitId (doc ID)
  unitNumber: string; // raw business identity (display)
  unitNumberNorm: string; // normalized for exact-match queries (trim+upper)
  projectName: string;
  unitDetail: string;
  customerName: string;
  brandName: string;
  unitType: string;
  concernNotes: string; // instructions/reminders for Field Audit

  // Denormalized current audit state (source of truth for lists/dashboard)
  status: UnitAuditStatus;
  currentSubmissionId: string | null;
  lock: AuditLock | null;

  submissionCount: number; // monotonic; drives the next submission version
  lastSubmittedAt: Timestamp | null;
  lastReviewedAt: Timestamp | null;
  lastReviewedBy: string | null; // supervisor uid
  lastRejectionNote: string | null;

  driveFolderId: string | null; // per-unit Drive folder (lazily created)

  createdAt: Timestamp;
  updatedAt: Timestamp;
  importBatchId: string; // which import created/last-touched this row
}

// Fields that come from the master-data Excel (overwritten on re-import)
export type AuditUnitMasterFields = Pick<
  AuditUnitDoc,
  | "unitNumber"
  | "unitNumberNorm"
  | "projectName"
  | "unitDetail"
  | "customerName"
  | "brandName"
  | "unitType"
  | "concernNotes"
>;

// ── Attachments (Google Drive) ──

export interface AuditAttachment {
  key: string; // "occupancy-lights" | "occupancy-vehicle" | "occupancy-trash" | "occupancy-other" | "extra-N" | custom
  label: string;
  required: boolean;
  fileId: string; // Google Drive file id
  webViewLink: string; // open-in-Drive link
  thumbnailLink: string | null; // for in-app preview
  fileName: string; // standardized name
  mimeType: string;
  uploadedAt: Timestamp;
  uploadedBy: string;
  editableAfterSubmit: boolean;
}

// ── Submission (immutable history entry) — subcollection of the unit ──
// auditUnits/{unitId}/submissions/{submissionId}

export interface AuditSubmissionDoc {
  id: string;
  unitId: string;
  unitNumber: string; // denormalized for export without joins
  version: number; // 1, 2, 3 … increments per resubmission
  status: AuditSubmissionStatus;

  submittedBy: string; // field-audit uid
  submittedByName: string;
  submittedAt: Timestamp;

  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: Timestamp | null;
  rejectionNote: string | null; // required when status === "rejected"

  // Form payload snapshot (immutable)
  occupancyStatus: OccupancyStatus;
  pltExists: boolean; // PLT / pelataran
  pltStatus?: PltStatus;
  pltNotes?: string;
  buildingConditionId: string;
  buildingConditionLabel: string;
  buildingTypeId: string;
  buildingTypeLabel: string;
  remarks: string;
  attachments: AuditAttachment[];
}

// ── Supervisor-managed category lists ──

export type AuditCategoryType = "buildingCondition" | "buildingType";

export interface AuditCategoryDoc {
  id: string;
  type: AuditCategoryType;
  label: string;
  order: number;
  isActive: boolean; // soft delete
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Import audit trail ──

export interface AuditImportDoc {
  id: string;
  importedBy: string;
  importedByName: string;
  importedAt: Timestamp;
  fileName: string;
  newCount: number;
  updatedCount: number;
  skippedCount: number;
  totalRows: number;
}

// ── Standard occupancy-indicator photo fields ──

export interface OccupancyPhotoField {
  key: string;
  label: string;
  required: boolean;
}

export const OCCUPANCY_PHOTO_FIELDS: OccupancyPhotoField[] = [
  { key: "occupancy-lights", label: "Lampu (nyala/mati)", required: true },
  { key: "occupancy-vehicle", label: "Kendaraan", required: true },
  { key: "occupancy-trash", label: "Sampah", required: true },
];
