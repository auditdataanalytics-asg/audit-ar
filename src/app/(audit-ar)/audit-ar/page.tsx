"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAuditAr } from "@/lib/audit-ar/hooks/use-audit-ar";

export default function AuditArIndexPage() {
  const { loading, auditRole } = useAuditAr();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (auditRole === "supervisor") router.replace("/audit-ar/supervisor");
    else if (auditRole === "fieldAudit") router.replace("/audit-ar/field");
    else router.replace("/");
  }, [loading, auditRole, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
