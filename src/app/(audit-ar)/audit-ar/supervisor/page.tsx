"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

import { STATUS_LABELS } from "@/components/audit-ar/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAuditUnits } from "@/lib/audit-ar/firestore";
import {
  UNIT_AUDIT_STATUSES,
  type AuditUnitDoc,
  type UnitAuditStatus,
} from "@/lib/audit-ar/types";

const AuditedTrendChart = dynamic(
  () => import("@/components/audit-ar/audited-trend-chart"),
  { ssr: false, loading: () => <div className="h-[260px]" /> },
);

type StatusCounts = Record<UnitAuditStatus, number>;

interface ProjectSummary {
  projectName: string;
  total: number;
  counts: StatusCounts;
}

function createStatusCounts(): StatusCounts {
  return {
    not_started: 0,
    draft: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
  };
}

export default function SupervisorDashboardPage() {
  const [units, setUnits] = useState<AuditUnitDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    getAuditUnits()
      .then((nextUnits) => {
        if (active) setUnits(nextUnits);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadAttempt]);

  const summary = useMemo(() => {
    const totals = createStatusCounts();
    const byProject = new Map<string, ProjectSummary>();

    for (const unit of units) {
      totals[unit.status]++;

      const projectName =
        unit.projectName?.trim().replace(/\s+/g, " ") || "Tanpa proyek";
      const projectKey = projectName.toLocaleLowerCase("id-ID");
      const project = byProject.get(projectKey) ?? {
        projectName,
        total: 0,
        counts: createStatusCounts(),
      };

      project.total++;
      project.counts[unit.status]++;
      byProject.set(projectKey, project);
    }

    const projects = Array.from(byProject.values()).sort((a, b) =>
      a.projectName.localeCompare(b.projectName, "id-ID", {
        numeric: true,
        sensitivity: "base",
      }),
    );

    return { projects, totals };
  }, [units]);

  const trend = useMemo(() => {
    const days = 14;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets = Array.from({ length: days }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() - (days - 1 - i));
      return {
        key: d.toDateString(),
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        count: 0,
      };
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

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Ringkasan progres audit lapangan.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="sr-only">Memuat ringkasan audit</span>
        </div>
      ) : loadError ? (
        <div
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-5"
          role="alert"
        >
          <p className="font-medium">Ringkasan gagal dimuat</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Periksa koneksi Anda, lalu coba lagi.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              setLoading(true);
              setLoadError(false);
              setLoadAttempt((attempt) => attempt + 1);
            }}
          >
            Coba lagi
          </Button>
        </div>
      ) : units.length > 0 ? (
        <>
          <ProjectSummaryTable
            rows={summary.projects}
            totals={summary.totals}
          />

          <section className="space-y-4">
            <h2 className="text-sm font-medium text-muted-foreground">
              Unit disetujui per hari · 14 hari terakhir
            </h2>
            <AuditedTrendChart data={trend} />
          </section>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Belum ada data. Mulai dengan{" "}
          <Link
            href="/audit-ar/supervisor/units/import"
            className="text-primary hover:underline"
          >
            import master data
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function ProjectSummaryTable({
  rows,
  totals,
}: {
  rows: ProjectSummary[];
  totals: StatusCounts;
}) {
  return (
    <section className="space-y-4" aria-labelledby="project-summary-title">
      <div>
        <h2
          id="project-summary-title"
          className="font-heading text-lg font-semibold"
        >
          Ringkasan per proyek
        </h2>
        <p className="text-sm text-muted-foreground">
          Setiap unit dihitung satu kali berdasarkan status audit terkininya.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60">
        <Table className="min-w-[760px]">
          <TableCaption className="sr-only">
            Jumlah unit per proyek dan status audit, beserta total keseluruhan.
          </TableCaption>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead
                scope="col"
                className="sticky left-0 z-20 min-w-48 bg-muted/90 px-4"
              >
                Proyek
              </TableHead>
              <TableHead scope="col" className="text-right">
                Total unit
              </TableHead>
              {UNIT_AUDIT_STATUSES.map((status) => (
                <TableHead key={status} scope="col" className="text-right">
                  {STATUS_LABELS[status]}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.projectName} className="group">
                <TableHead
                  scope="row"
                  className="sticky left-0 z-10 bg-background px-4 py-3 font-medium group-hover:bg-muted/50"
                >
                  {row.projectName}
                </TableHead>
                <TableCell className="text-right font-medium tabular-nums">
                  {row.total}
                </TableCell>
                {UNIT_AUDIT_STATUSES.map((status) => (
                  <TableCell key={status} className="text-right tabular-nums">
                    {row.counts[status]}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableHead
                scope="row"
                className="sticky left-0 z-10 bg-muted px-4 font-semibold"
              >
                Total
              </TableHead>
              <TableCell className="text-right tabular-nums">
                {rows.reduce((sum, row) => sum + row.total, 0)}
              </TableCell>
              {UNIT_AUDIT_STATUSES.map((status) => (
                <TableCell key={status} className="text-right tabular-nums">
                  {totals[status]}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </section>
  );
}
