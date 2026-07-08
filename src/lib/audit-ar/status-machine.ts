import type { AuditRole, UnitAuditStatus } from "./types";

// Allowed unit-status transitions and who may trigger them.
// (Lock expiry / cancel back to "not_started" is a system/owner action.)
interface Transition {
  from: UnitAuditStatus;
  to: UnitAuditStatus;
  role: AuditRole | "system";
}

const TRANSITIONS: Transition[] = [
  { from: "not_started", to: "draft", role: "fieldAudit" }, // start audit (acquire lock)
  { from: "draft", to: "not_started", role: "fieldAudit" }, // cancel / abandon
  { from: "draft", to: "not_started", role: "system" }, // lock expiry sweep
  { from: "draft", to: "pending", role: "fieldAudit" }, // submit
  { from: "rejected", to: "pending", role: "fieldAudit" }, // revise & resubmit
  { from: "pending", to: "approved", role: "supervisor" },
  { from: "pending", to: "rejected", role: "supervisor" },
];

export function canTransition(
  from: UnitAuditStatus,
  to: UnitAuditStatus,
  role: AuditRole | "system",
): boolean {
  return TRANSITIONS.some(
    (t) => t.from === from && t.to === to && t.role === role,
  );
}

/** Statuses a Field Auditor may acquire a draft lock from. */
export function isLockable(status: UnitAuditStatus): boolean {
  return status === "not_started" || status === "draft" || status === "rejected";
}
