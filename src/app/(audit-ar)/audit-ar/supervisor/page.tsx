"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

import { Stat, StatGroup } from "@/components/shared/stat";
import { getAuditUnits } from "@/lib/audit-ar/firestore";
import type { AuditUnitDoc, UnitAuditStatus } from "@/lib/audit-ar/types";

const AuditedTrendChart = dynamic(
  () => import("@/components/audit-ar/audited-trend-chart"),
  { ssr: false, loading: () => <div className="h-[260px]" /> },
);

export default function SupervisorDashboardPage() {
  const [units, setUnits] = useState<AuditUnitDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAuditUnits()
      .then(setUnits)
      .finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => {
    const c: Record<UnitAuditStatus, number> = {
      not_started: 0,
      draft: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
    };
    for (const u of units) c[u.status]++;
    return c;
  }, [units]);

  const trend = useMemo(() => {
    const days = 14;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets = Array.from({ length: days }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - (days - 1 - i));
      return { key: d.toDateString(), label: `${d.getDate()}/${d.getMonth() + 1}`, count: 0 };
    });
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    for (const u of units) {
      if (u.status === "approved" && u.lastReviewedAt) {
        const d = u.lastReviewedAt.toDate();
        d.setHours(0, 0, 0, 0);
        const i = idx.get(d.toDateString());
        if (i !== undefined) buckets[i].count++;
      }
    }
    return buckets.map((b) => ({ label: b.label, count: b.count }));
  }, [units]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const unaudited = units.length - counts.approved;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Ringkasan progres audit lapangan.</p>
      </div>

      <StatGroup className="grid-cols-2 border-y border-border/60 py-7 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Total unit" value={units.length} />
        <Stat label="Sudah diaudit" value={counts.approved} accent="positive" />
        <Stat label="Belum diaudit" value={unaudited} />
        <Stat label="Menunggu review" value={counts.pending} accent="warning" />
        <Stat label="Disetujui" value={counts.approved} accent="positive" />
        <Stat label="Ditolak" value={counts.rejected} accent="negative" />
        <Stat label="Draft" value={counts.draft} />
      </StatGroup>

      {units.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            Unit disetujui per hari · 14 hari terakhir
          </h2>
          <AuditedTrendChart data={trend} />
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Belum ada data. Mulai dengan{" "}
          <Link href="/audit-ar/supervisor/units/import" className="text-primary hover:underline">
            import master data
          </Link>
          .
        </p>
      )}
    </div>
  );
}
