"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAuditAr } from "@/lib/audit-ar/hooks/use-audit-ar";
import { isModuleEnabled } from "@/lib/workspace/modules";
import type { AuditRole } from "@/lib/audit-ar/types";

interface AuditArGuardProps {
  children: React.ReactNode;
  requireRole?: AuditRole;
}

export function AuditArGuard({ children, requireRole }: AuditArGuardProps) {
  const { user, loading, auditEnabled, auditRole } = useAuditAr();
  const router = useRouter();
  const moduleOn = isModuleEnabled("auditAr");

  // A supervisor satisfies both supervisor- and field-audit-gated routes;
  // a field auditor only satisfies field-audit routes.
  const roleAllowed =
    !requireRole ||
    (requireRole === "supervisor"
      ? auditRole === "supervisor"
      : auditRole === "supervisor" || auditRole === "fieldAudit");

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!moduleOn || !auditEnabled || !auditRole) {
      router.replace("/");
      return;
    }
    if (!roleAllowed) {
      router.replace(
        auditRole === "supervisor" ? "/audit-ar/supervisor" : "/audit-ar/field",
      );
    }
  }, [loading, user, moduleOn, auditEnabled, auditRole, roleAllowed, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || !moduleOn || !auditEnabled || !auditRole) return null;
  if (!roleAllowed) return null;

  return <>{children}</>;
}
