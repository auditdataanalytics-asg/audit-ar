"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, UploadCloud, Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge, STATUS_LABELS } from "@/components/audit-ar/status-badge";
import { getAuditUnits, getSubmission } from "@/lib/audit-ar/firestore";
import {
  UNIT_AUDIT_STATUSES,
  OCCUPANCY_PHOTO_FIELDS,
  type AuditUnitDoc,
  type UnitAuditStatus,
} from "@/lib/audit-ar/types";
import { cn } from "@/lib/utils";

export default function SupervisorUnitsPage() {
  const [units, setUnits] = useState<AuditUnitDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<UnitAuditStatus | "all">("all");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    getAuditUnits()
      .then((u) => setUnits(u))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return units
      .filter((u) => (statusFilter === "all" ? true : u.status === statusFilter))
      .filter((u) =>
        !q
          ? true
          : [u.unitNumber, u.projectName, u.customerName, u.brandName]
              .filter(Boolean)
              .some((v) => v.toLowerCase().includes(q)),
      )
      .sort((a, b) =>
        a.projectName === b.projectName
          ? a.unitNumberNorm.localeCompare(b.unitNumberNorm)
          : a.projectName.localeCompare(b.projectName),
      );
  }, [units, search, statusFilter]);

  async function handleExport() {
    setExporting(true);
    try {
      const subs = await Promise.all(
        filtered.map((u) =>
          u.currentSubmissionId
            ? getSubmission(u.id, u.currentSubmissionId)
            : Promise.resolve(null),
        ),
      );
      const rows = filtered.map((u, i) => {
        const s = subs[i];
        const linkFor = (key: string) =>
          s?.attachments.find((a) => a.key === key)?.webViewLink ?? "";
        const row: Record<string, string> = {
          "Nomor Unit": u.unitNumber,
          Proyek: u.projectName,
          "Detail Unit": u.unitDetail,
          Customer: u.customerName,
          Brand: u.brandName,
          "Tipe Unit": u.unitType,
          "Catatan Audit": u.concernNotes,
          Status: STATUS_LABELS[u.status],
          "Status Hunian": s
            ? s.occupancyStatus === "occupied"
              ? "Berpenghuni"
              : "Tidak berpenghuni"
            : "",
          "PLT/Pelataran": s ? (s.pltExists ? "Ada" : "Tidak ada") : "",
          "Kondisi Bangunan": s?.buildingConditionLabel ?? "",
          "Tipe Bangunan": s?.buildingTypeLabel ?? "",
          Catatan: s?.remarks ?? "",
          Reviewer: s?.reviewedByName ?? "",
          "Alasan Penolakan": u.lastRejectionNote ?? "",
        };
        for (const f of OCCUPANCY_PHOTO_FIELDS) {
          row[`Foto ${f.label}`] = linkFor(f.key);
        }
        row["Lampiran Tambahan"] = (s?.attachments ?? [])
          .filter((a) => a.key.startsWith("extra"))
          .map((a) => a.webViewLink)
          .join(", ");
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Audit AR");
      XLSX.writeFile(wb, "audit-ar-hasil.xlsx");
    } catch {
      toast.error("Gagal export Excel");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            Unit & Master Data
          </h1>
          <p className="text-sm text-muted-foreground">
            {units.length} unit terdaftar
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={handleExport}
            disabled={exporting || units.length === 0}
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export
          </Button>
          <Link
            href="/audit-ar/supervisor/units/import"
            className={cn(buttonVariants({ variant: "default" }), "gap-1.5")}
          >
            <UploadCloud className="h-4 w-4" />
            Import Excel
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari unit, proyek, customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip label="Semua" active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
          {UNIT_AUDIT_STATUSES.map((s) => (
            <FilterChip
              key={s}
              label={STATUS_LABELS[s]}
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
            />
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={units.length === 0 ? "Belum ada master data" : "Tidak ada unit"}
          description={
            units.length === 0
              ? "Import file Excel untuk memulai."
              : "Tidak ada unit yang cocok dengan filter."
          }
        />
      ) : (
        <div className="rounded-lg border border-border/50 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nomor Unit</TableHead>
                <TableHead>Proyek</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.id} className="cursor-pointer">
                  <TableCell className="font-medium">
                    <Link href={`/audit-ar/supervisor/units/${u.id}`} className="hover:underline">
                      {u.unitNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.projectName}</TableCell>
                  <TableCell className="text-muted-foreground">{u.customerName || "-"}</TableCell>
                  <TableCell className="text-muted-foreground">{u.unitType || "-"}</TableCell>
                  <TableCell>
                    <StatusBadge status={u.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      className="h-8 rounded-full text-xs"
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
