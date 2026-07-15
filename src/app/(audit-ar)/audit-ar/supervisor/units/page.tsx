"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, UploadCloud, Loader2, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import {
  getAuditUnits,
  getSubmission,
  deleteUnit,
  deleteAllUnits,
} from "@/lib/audit-ar/firestore";
import { useAuditAr } from "@/lib/audit-ar/hooks/use-audit-ar";
import {
  UNIT_AUDIT_STATUSES,
  formatPltStatus,
  CONCERN_FLAG_LABEL,
  type AuditUnitDoc,
  type UnitAuditStatus,
} from "@/lib/audit-ar/types";
import { cn } from "@/lib/utils";

export default function SupervisorUnitsPage() {
  const { isSupervisor } = useAuditAr();
  const [units, setUnits] = useState<AuditUnitDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<UnitAuditStatus | "all">("all");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(() => getAuditUnits().then((u) => setUnits(u)), []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  // Optimistic local updates so the list feels instant — the delete route does
  // the heavy (backup + throttled) work; we don't re-read the whole collection.
  const removeUnit = useCallback(
    (id: string) => setUnits((prev) => prev.filter((u) => u.id !== id)),
    [],
  );
  const clearUnits = useCallback(() => setUnits([]), []);

  const auditedCount = useMemo(
    () => units.filter((u) => u.submissionCount > 0).length,
    [units],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return units
      .filter((u) => (statusFilter === "all" ? true : u.status === statusFilter))
      .filter((u) =>
        !q
          ? true
          : [u.unitNumber, u.projectName, u.cluster, u.brandName]
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
        const row: Record<string, string> = {
          "Nomor Unit": u.unitNumber,
          Proyek: u.projectName,
          Cluster: u.cluster ?? "",
          "Detail Unit": u.unitDetail,
          "Pelataran (Data Sistem)": u.pelataranSistem ? "Yes" : "No",
          Brand: u.brandName,
          "Tipe Unit": u.unitType,
          "Catatan Audit": u.concernNotes,
          "Flag Audit": (u.concernFlags ?? [])
            .map((k) => CONCERN_FLAG_LABEL[k] ?? k)
            .join(", "),
          Status: STATUS_LABELS[u.status],
          "Status Hunian": s
            ? s.occupancyStatus === "occupied"
              ? "Berpenghuni"
              : "Tidak berpenghuni"
            : "",
          "PLT/Pelataran": s
            ? formatPltStatus(s.pltStatus, s.pltNotes, s.pltExists)
            : "",
          "Kondisi Bangunan": s?.buildingConditionLabel ?? "",
          "Tipe Bangunan": s?.buildingTypeLabel ?? "",
          Catatan: s?.remarks ?? "",
          Reviewer: s?.reviewedByName ?? "",
          "Alasan Penolakan": u.lastRejectionNote ?? "",
          "Jumlah Foto": s ? String(s.attachments.length) : "",
          "Foto Audit": (s?.attachments ?? [])
            .map((a, index) => `${index + 1}. ${a.label}: ${a.webViewLink}`)
            .join("\n"),
        };
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
          {isSupervisor && units.length > 0 && (
            <DeleteAllButton
              total={units.length}
              auditedCount={auditedCount}
              onDeleted={clearUnits}
              onError={load}
            />
          )}
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
                <TableHead>Cluster</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Status</TableHead>
                {isSupervisor && <TableHead className="w-10 text-right">Aksi</TableHead>}
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
                  <TableCell className="text-muted-foreground">{u.cluster || "-"}</TableCell>
                  <TableCell className="text-muted-foreground">{u.unitType || "-"}</TableCell>
                  <TableCell>
                    <StatusBadge status={u.status} />
                  </TableCell>
                  {isSupervisor && (
                    <TableCell className="text-right">
                      <DeleteUnitButton unit={u} onDeleted={removeUnit} onError={load} />
                    </TableCell>
                  )}
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

function DeleteUnitButton({
  unit,
  onDeleted,
  onError,
}: {
  unit: AuditUnitDoc;
  onDeleted: (id: string) => void;
  onError: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const audited = unit.submissionCount > 0;

  async function confirm() {
    setBusy(true);
    try {
      await deleteUnit(unit.id);
      toast.success(`Unit ${unit.unitNumber} dihapus`);
      setOpen(false);
      onDeleted(unit.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus unit");
      onError();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setAck(false);
      }}
    >
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Hapus unit ${unit.unitNumber}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus unit {unit.unitNumber}?</AlertDialogTitle>
          <AlertDialogDescription>
            {audited
              ? "Unit ini sudah memiliki data audit (submission). Unit beserta seluruh riwayat auditnya akan dipindahkan ke arsip backup, lalu hilang dari aplikasi."
              : "Unit ini belum diaudit. Datanya akan dipindahkan ke arsip backup, lalu hilang dari aplikasi."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {audited && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={ack}
              onCheckedChange={(checked) => setAck(checked === true)}
              className="mt-0.5"
            />
            <span>Saya paham data audit unit ini akan dihapus dari aplikasi.</span>
          </label>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy || (audited && !ack)}
            onClick={confirm}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-4 w-4" />
            )}
            Hapus
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const DELETE_ALL_PHRASE = "HAPUS SEMUA";

function DeleteAllButton({
  total,
  auditedCount,
  onDeleted,
  onError,
}: {
  total: number;
  auditedCount: number;
  onDeleted: () => void;
  onError: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      const res = await deleteAllUnits();
      toast.success(`${res.deleted} unit dihapus (backup: ${res.backedUp})`);
      setOpen(false);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus unit");
      onError();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setText("");
      }}
    >
      <AlertDialogTrigger
        render={
          <Button variant="destructive" className="gap-1.5">
            <Trash2 className="h-4 w-4" />
            Hapus Semua
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus SEMUA unit?</AlertDialogTitle>
          <AlertDialogDescription>
            {total} unit akan dihapus
            {auditedCount > 0
              ? `, ${auditedCount} di antaranya sudah memiliki data audit`
              : ""}
            . Seluruh data (unit + riwayat submission) dipindahkan ke arsip backup
            lebih dulu, tetapi hilang dari aplikasi. Ketik{" "}
            <b className="text-foreground">{DELETE_ALL_PHRASE}</b> untuk konfirmasi.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={DELETE_ALL_PHRASE}
          autoFocus
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Batal</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy || text.trim() !== DELETE_ALL_PHRASE}
            onClick={confirm}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-4 w-4" />
            )}
            Hapus Semua
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
