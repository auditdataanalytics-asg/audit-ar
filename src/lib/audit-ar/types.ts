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
  // Server-authoritative acquire/refresh time. A lock is valid while
  // `lockedAt + LOCK_TTL_MS` is in the future — judged with the server clock in
  // rules/cron, so a device's clock is never trusted for correctness. The
  // heartbeat pushes this forward; no separate client-minted expiry field.
  lockedAt: Timestamp;
}

// ── Audit concern flags (the "Data Opname" matrix columns) ──
// Each unit carries a subset of these keys (the columns that were "1" in the
// import). Rendered as a short-label checklist under "Catatan Audit". `header`
// is the (lower-cased) Excel column used to match during import — the single
// source of truth for both parsing and display.

export const CONCERN_FLAGS = [
  { key: "followUpAr", label: "Follow up AR", header: "unit dengan ar tidak di fu / sulit dihubungi / tidak ada respon" },
  { key: "arOver90", label: "AR > 90 hari", header: "unit dengan ar full unpaid / long outstanding" },
  { key: "identUnitPom", label: "Identifikasi Unit POM", header: "unit konfirmasi yang tidak masuk unit pom" },
  { key: "identPlt", label: "Identifikasi PLT", header: "identifikasi eksistensi unit pelataran" },
  { key: "konfirmasiPlt", label: "Konfirmasi PLT", header: "selisih pelataran" },
  { key: "konfirmasiPltPeriod", label: "Konfirmasi PLT (Period)", header: "unit pelataran - gap period rent" },
  { key: "waterOnly", label: "Water only", header: "terdapat water tanpa service charge" },
  { key: "svcOnly", label: "SVC only", header: "terdapat service charge tanpa water" },
] as const;

export const CONCERN_FLAG_LABEL: Record<string, string> = Object.fromEntries(
  CONCERN_FLAGS.map((f) => [f.key, f.label]),
);

// ── Master-data unit ──

export interface AuditUnitDoc {
  id: string; // slugged+hashed unitId (doc ID)
  unitNumber: string; // raw business identity (display) — "Kode Unit"
  unitNumberNorm: string; // normalized for exact-match queries (trim+upper)
  projectName: string;
  cluster: string; // Klaster
  unitDetail: string;
  pelataranSistem: boolean; // Pelataran (Data Sistem): Yes=true / No=false
  brandName: string;
  unitType: string;
  concernNotes: string; // free-text instructions/reminders for Field Audit
  concernFlags: string[]; // active CONCERN_FLAGS keys from the import matrix

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

  draft?: AuditDraft | null; // in-progress field-audit draft (fields + uploaded photos)

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
  | "cluster"
  | "unitDetail"
  | "pelataranSistem"
  | "brandName"
  | "unitType"
  | "concernNotes"
  | "concernFlags"
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

// ── In-progress draft (persisted on the unit doc while a field auditor works) ──

export interface AuditDraft {
  occupancyStatus: OccupancyStatus | "";
  pltStatus: PltStatus | "";
  pltNotes: string;
  buildingConditionId: string;
  buildingTypeId: string;
  remarks: string;
  attachments: AuditAttachment[];
  updatedBy: string; // field-audit uid who owns this draft
  updatedAt: Timestamp;
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
