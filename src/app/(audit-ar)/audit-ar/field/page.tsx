"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, ArrowRight } from "lucide-react";

import { Stat, StatGroup } from "@/components/shared/stat";
import { getAuditUnits } from "@/lib/audit-ar/firestore";
import { useAuditAr } from "@/lib/audit-ar/hooks/use-audit-ar";
import type { AuditUnitDoc } from "@/lib/audit-ar/types";

export default function FieldDashboardPage() {
  const { user } = useAuditAr();
  const [units, setUnits] = useState<AuditUnitDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAuditUnits()
      .then(setUnits)
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const now = Date.now();
    const available = units.filter(
      (u) =>
        u.status === "not_started" ||
        (u.status === "draft" && (!u.lock || u.lock.lockExpiresAt.toMillis() < now)),
    ).length;
    const myDrafts = units.filter(
      (u) => u.status === "draft" && u.lock?.lockedBy === user?.uid,
    ).length;
    const rejected = units.filter((u) => u.status === "rejected").length;
    return { available, myDrafts, rejected };
  }, [units, user?.uid]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const firstName = user?.displayName?.split(" ")[0] || "Auditor";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-xl font-bold tracking-tight">Halo, {firstName}</h1>
        <p className="text-sm text-muted-foreground">Ringkasan tugas lapanganmu.</p>
      </div>

      <StatGroup className="grid-cols-3 border-y border-border/60 py-6">
        <Stat label="Belum diaudit" value={stats.available} />
        <Stat label="Draft saya" value={stats.myDrafts} accent="primary" />
        <Stat label="Perlu revisi" value={stats.rejected} accent="negative" />
      </StatGroup>

      <Link
        href="/audit-ar/field/units"
        className="group flex items-center justify-between rounded-xl border border-border/60 p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
      >
        <div>
          <p className="font-medium">Lihat daftar unit</p>
          <p className="text-sm text-muted-foreground">Cari dan mulai audit unit</p>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
      </Link>
    </div>
  );
}
