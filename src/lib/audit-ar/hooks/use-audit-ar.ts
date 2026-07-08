"use client";

import { useAuth } from "@/lib/shared/use-auth";
import type { AuditRole } from "../types";

export interface AuditArState {
  user: ReturnType<typeof useAuth>["user"];
  loading: boolean;
  auditEnabled: boolean;
  auditRole: AuditRole | null;
  isSupervisor: boolean;
  isFieldAudit: boolean;
  // A supervisor can also act as a field auditor (supervisor ⊇ field audit).
  canFieldAudit: boolean;
}

/**
 * Audit AR access for the current user, derived from the shared auth snapshot
 * (the generic `modules.auditAr` record on the user doc). Reuses useAuth's
 * single Firestore listener — no extra subscription.
 */
export function useAuditAr(): AuditArState {
  const { user, loading, modules } = useAuth();
  const audit = modules?.auditAr;
  const auditEnabled = !!audit?.enabled;
  const auditRole = (auditEnabled ? (audit?.role ?? null) : null) as AuditRole | null;
  return {
    user,
    loading,
    auditEnabled,
    auditRole,
    isSupervisor: auditRole === "supervisor",
    isFieldAudit: auditRole === "fieldAudit",
    canFieldAudit: auditRole === "supervisor" || auditRole === "fieldAudit",
  };
}
