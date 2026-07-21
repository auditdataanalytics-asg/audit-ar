"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Images, Loader2, Search } from "lucide-react";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { StatusBadge, STATUS_LABELS } from "@/components/audit-ar/status-badge";
import { AuditPhotoImage } from "@/components/audit-ar/audit-photo-image";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  countAuditedUnits,
  countUnits,
  getAuditUnits,
  getAuditUnitsPage,
  getSubmission,
  shareUnitDriveFolders,
} from "@/lib/audit-ar/firestore";
import { addUrlHyperlinks, driveFolderUrl } from "@/lib/audit-ar/excel-export";
import {
  CONCERN_FLAG_LABEL,
  UNIT_AUDIT_STATUSES,
  formatPltStatus,
  type AuditAttachment,
  type AuditSubmissionDoc,
  type AuditUnitDoc,
  type UnitAuditStatus,
} from "@/lib/audit-ar/types";
import { formatDateTime } from "@/lib/shared/date-format";

const PAGE_SIZE = 50;

interface AuditResult {
  unit: AuditUnitDoc;
  submission: AuditSubmissionDoc | null;
}

async function loadResults(units: AuditUnitDoc[]): Promise<AuditResult[]> {
  const submissions = await Promise.all(
    units.map((unit) =>
      unit.currentSubmissionId
        ? getSubmission(unit.id, unit.currentSubmissionId)
        : Promise.resolve(null),
    ),
  );

  return units.map((unit, index) => ({ unit, submission: submissions[index] }));
}

export default function SupervisorAuditResultsPage() {
  const [results, setResults] = useState<AuditResult[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<UnitAuditStatus | "all">("all");
  const [total, setTotal] = useState<number | null>(null);
  const [auditedTotal, setAuditedTotal] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const refreshTotals = useCallback(() => {
    countUnits()
      .then(setTotal)
      .catch(() => setTotal(null));
    countAuditedUnits()
      .then(setAuditedTotal)
      .catch(() => setAuditedTotal(null));
  }, []);

  useEffect(() => {
    refreshTotals();
  }, [refreshTotals]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      getAuditUnitsPage({ statusFilter, search, pageSize: PAGE_SIZE })
        .then(async (page) => ({ page, rows: await loadResults(page.units) }))
        .then(({ page, rows }) => {
          if (!active) return;
          setResults(rows);
          setCursor(page.cursor);
          setHasMore(page.hasMore);
        })
        .catch(() => {
          if (active) toast.error("Gagal memuat hasil audit");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [statusFilter, search]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await getAuditUnitsPage({
        statusFilter,
        search,
        cursor,
        pageSize: PAGE_SIZE,
      });
      const rows = await loadResults(page.units);
      setResults((previous) => [...previous, ...rows]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch {
      toast.error("Gagal memuat lebih banyak");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const allUnits = await getAuditUnits();
      const allResults = await loadResults(allUnits);
      await shareUnitDriveFolders(
        allUnits.filter((unit) => unit.driveFolderId).map((unit) => unit.id),
      );
      const rows = allResults.map(({ unit, submission }) => ({
        "Nomor Unit": unit.unitNumber,
        Proyek: unit.projectName,
        Cluster: unit.cluster ?? "",
        "Detail Unit": unit.unitDetail,
        "Pelataran (Data Sistem)": unit.pelataranSistem ? "Yes" : "No",
        Brand: unit.brandName,
        "Tipe Unit": unit.unitType,
        "Catatan Audit": unit.concernNotes,
        "Flag Audit": (unit.concernFlags ?? [])
          .map((key) => CONCERN_FLAG_LABEL[key] ?? key)
          .join(", "),
        "Status Pemeriksaan Supervisor": STATUS_LABELS[unit.status],
        "Status Hunian": occupancyLabel(submission),
        "PLT/Pelataran": submission
          ? formatPltStatus(submission.pltStatus, submission.pltNotes, submission.pltExists)
          : "",
        "Kondisi Bangunan": submission?.buildingConditionLabel ?? "",
        "Tipe Bangunan": submission?.buildingTypeLabel ?? "",
        Catatan: submission?.remarks ?? "",
        "Pemeriksa Supervisor": submission?.reviewedByName ?? "",
        "Alasan Penolakan": submission?.rejectionNote ?? "",
        "Jumlah Foto": submission ? String((submission.attachments ?? []).length) : "",
        "Foto Audit": driveFolderUrl(unit.driveFolderId),
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      addUrlHyperlinks(
        worksheet,
        rows,
        "Foto Audit",
        "Buka folder foto audit unit di Google Drive",
      );
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Hasil Audit");
      XLSX.writeFile(workbook, "audit-ar-hasil.xlsx");
    } catch (error) {
      toast.error(
        error instanceof Error ? `Gagal export Excel: ${error.message}` : "Gagal export Excel",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Hasil Audit</h1>
          <p className="text-sm text-muted-foreground">
            {auditedTotal ?? "…"} dari {total ?? "…"} unit memiliki hasil audit
          </p>
        </div>
        <Button
          variant="outline"
          className="gap-1.5"
          onClick={handleExport}
          disabled={exporting || (total ?? 0) === 0}
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari nomor unit (awalan)..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            label="Semua"
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          />
          {UNIT_AUDIT_STATUSES.map((status) => (
            <FilterChip
              key={status}
              label={STATUS_LABELS[status]}
              active={statusFilter === status}
              onClick={() => setStatusFilter(status)}
            />
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : results.length === 0 ? (
        <EmptyState
          title={total === 0 ? "Belum ada master data" : "Tidak ada hasil audit"}
          description={
            total === 0
              ? "Import master data unit terlebih dahulu."
              : "Tidak ada unit yang cocok dengan filter/pencarian."
          }
        />
      ) : (
        <>
          <div className="overflow-auto rounded-lg border border-border/50">
            <Table className="min-w-[1120px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-32">Nomor Unit</TableHead>
                  <TableHead className="min-w-40">Proyek</TableHead>
                  <TableHead className="min-w-36">Status Hunian</TableHead>
                  <TableHead className="min-w-40">PLT / Pelataran</TableHead>
                  <TableHead className="min-w-40">Kondisi Bangunan</TableHead>
                  <TableHead className="min-w-36">Tipe Bangunan</TableHead>
                  <TableHead className="min-w-28">Foto Audit</TableHead>
                  <TableHead className="min-w-40">Status Supervisor</TableHead>
                  <TableHead className="w-24 text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map(({ unit, submission }) => (
                  <TableRow key={unit.id}>
                    <TableCell className="font-medium">{unit.unitNumber}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {unit.projectName || "-"}
                    </TableCell>
                    <TableCell>{occupancyLabel(submission) || "-"}</TableCell>
                    <TableCell>
                      {submission
                        ? formatPltStatus(
                            submission.pltStatus,
                            submission.pltNotes,
                            submission.pltExists,
                          )
                        : "-"}
                    </TableCell>
                    <TableCell>{submission?.buildingConditionLabel || "-"}</TableCell>
                    <TableCell>{submission?.buildingTypeLabel || "-"}</TableCell>
                    <TableCell>
                      <AuditPhotoSummary unit={unit} submission={submission} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={unit.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <AuditResultDetailDialog unit={unit} submission={submission} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Muat lebih banyak
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function occupancyLabel(submission: AuditSubmissionDoc | null): string {
  if (!submission) return "";
  return submission.occupancyStatus === "occupied"
    ? "Berpenghuni"
    : "Tidak berpenghuni";
}

function AuditPhotoSummary({
  unit,
  submission,
}: {
  unit: AuditUnitDoc;
  submission: AuditSubmissionDoc | null;
}) {
  const attachments = submission?.attachments ?? [];
  if (attachments.length === 0) return "-";

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 whitespace-nowrap"
            aria-label={`Lihat ${attachments.length} foto audit unit ${unit.unitNumber}`}
          />
        }
      >
        <Images className="h-4 w-4" />
        Lihat {attachments.length} foto
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader className="pr-8">
          <DialogTitle>Foto Audit · {unit.unitNumber}</DialogTitle>
          <DialogDescription>
            {attachments.length} foto dari {unit.projectName || "proyek tanpa nama"}
          </DialogDescription>
        </DialogHeader>
        <AuditPhotoGallery attachments={attachments} />
      </DialogContent>
    </Dialog>
  );
}

function AuditPhotoGallery({ attachments }: { attachments: AuditAttachment[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selectedPhoto = selectedIndex == null ? null : attachments[selectedIndex];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {attachments.map((attachment, index) => (
          <article
            key={attachment.fileId || `${attachment.webViewLink}-${index}`}
            className="overflow-hidden rounded-lg border bg-muted/20"
          >
            <button
              type="button"
              onClick={() => setSelectedIndex(index)}
              className="group block w-full cursor-zoom-in bg-muted/40 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
              aria-label={`Perbesar foto ${index + 1}: ${attachment.label || "Tanpa keterangan"}`}
            >
              <AuditPhotoImage
                key={attachment.fileId}
                attachment={attachment}
                size={720}
                alt={attachment.label || `Foto ${index + 1}`}
                className="h-52 w-full object-contain transition-transform group-hover:scale-[1.02]"
              />
            </button>
            <div className="space-y-2 p-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  Foto {index + 1} · Keterangan
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm font-medium">
                  {attachment.label || "Tanpa keterangan"}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>

      <Dialog
        open={selectedPhoto != null}
        onOpenChange={(open) => {
          if (!open) setSelectedIndex(null);
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
          {selectedPhoto && (
            <>
              <DialogHeader className="pr-8">
                <DialogTitle>
                  Foto {(selectedIndex ?? 0) + 1} · {selectedPhoto.label || "Tanpa keterangan"}
                </DialogTitle>
              </DialogHeader>
              <AuditPhotoImage
                key={selectedPhoto.fileId}
                attachment={selectedPhoto}
                size={1600}
                alt={selectedPhoto.label || `Foto ${(selectedIndex ?? 0) + 1}`}
                className="max-h-[75vh] min-h-72 w-full rounded-lg bg-black/5 object-contain"
              />
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Keterangan</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">
                  {selectedPhoto.label || "Tanpa keterangan"}
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AuditResultDetailDialog({
  unit,
  submission,
}: {
  unit: AuditUnitDoc;
  submission: AuditSubmissionDoc | null;
}) {
  const attachments = submission?.attachments ?? [];
  const concernFlags = unit.concernFlags ?? [];

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Detail
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{unit.unitNumber}</DialogTitle>
            <StatusBadge status={unit.status} />
          </div>
          <DialogDescription>{unit.projectName || "Proyek tidak tersedia"}</DialogDescription>
        </DialogHeader>

        <section className="space-y-3">
          <h3 className="border-b pb-2 font-heading font-semibold">Master Data</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DetailField label="Proyek" value={unit.projectName || "-"} />
            <DetailField label="Cluster" value={unit.cluster || "-"} />
            <DetailField label="Detail Unit" value={unit.unitDetail || "-"} />
            <DetailField
              label="Pelataran (Data Sistem)"
              value={unit.pelataranSistem ? "Yes" : "No"}
            />
            <DetailField label="Brand" value={unit.brandName || "-"} />
            <DetailField label="Tipe Unit" value={unit.unitType || "-"} />
          </div>
          {(concernFlags.length > 0 || unit.concernNotes) && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                Catatan Audit
              </p>
              {concernFlags.length > 0 && (
                <p className="mt-1.5 text-sm">
                  {concernFlags.map((key) => CONCERN_FLAG_LABEL[key] ?? key).join(", ")}
                </p>
              )}
              {unit.concernNotes && <p className="mt-1.5 text-sm">{unit.concernNotes}</p>}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="border-b pb-2 font-heading font-semibold">Hasil Audit</h3>
          {submission ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <DetailField label="Status Hunian" value={occupancyLabel(submission)} />
                <DetailField
                  label="PLT / Pelataran"
                  value={formatPltStatus(
                    submission.pltStatus,
                    submission.pltNotes,
                    submission.pltExists,
                  )}
                />
                <DetailField
                  label="Kondisi Bangunan"
                  value={submission.buildingConditionLabel || "-"}
                />
                <DetailField
                  label="Tipe Bangunan"
                  value={submission.buildingTypeLabel || "-"}
                />
                <DetailField label="Dikirim Oleh" value={submission.submittedByName || "-"} />
                <DetailField
                  label="Waktu Pengiriman"
                  value={
                    submission.submittedAt
                      ? formatDateTime(submission.submittedAt.toDate())
                      : "-"
                  }
                />
              </div>
              <DetailField label="Catatan" value={submission.remarks || "-"} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Belum ada hasil audit untuk unit ini.</p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="border-b pb-2 font-heading font-semibold">
            Pemeriksaan Supervisor
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <StatusBadge status={unit.status} className="mt-1" />
            </div>
            <DetailField
              label="Pemeriksa Supervisor"
              value={submission?.reviewedByName || "-"}
            />
            <DetailField
              label="Waktu Pemeriksaan"
              value={
                submission?.reviewedAt
                  ? formatDateTime(submission.reviewedAt.toDate())
                  : "-"
              }
            />
          </div>
          {submission?.rejectionNote && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <p className="text-xs font-medium text-destructive">Alasan Penolakan</p>
              <p className="mt-1 text-sm">{submission.rejectionNote}</p>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="border-b pb-2 font-heading font-semibold">
            Foto Audit ({attachments.length})
          </h3>
          {attachments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tidak ada foto audit.</p>
          ) : (
            <AuditPhotoGallery attachments={attachments} />
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm">{value}</p>
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
