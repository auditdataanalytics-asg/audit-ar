"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  UploadCloud,
  Download,
  ChevronLeft,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { auditUnitRowSchema, type AuditUnitRow } from "@/lib/audit-ar/validators";
import {
  diffUnitsAgainstExisting,
  batchUpsertAuditUnits,
  createImportRecord,
  type UnitDiffEntry,
} from "@/lib/audit-ar/firestore";
import { normalizeUnitNumber } from "@/lib/audit-ar/unit-id";
import { CONCERN_FLAGS } from "@/lib/audit-ar/types";
import { useAuditAr } from "@/lib/audit-ar/hooks/use-audit-ar";
import { cn } from "@/lib/utils";

interface PreviewRow {
  rowNum: number;
  data: AuditUnitRow | null;
  valid: boolean;
  error?: string;
  isNew?: boolean;
}

// String columns of the "Data Opname" sheet → their accepted header spellings
// (lower-cased, whitespace-collapsed). Header-driven: matched by exact name.
type StringCol =
  | "unitNumber"
  | "projectName"
  | "cluster"
  | "unitDetail"
  | "pelataranSistem"
  | "brandName"
  | "unitType"
  | "concernNotes";

const COLUMN_ALIASES: Record<StringCol, string[]> = {
  projectName: ["final project", "nama proyek", "proyek", "project", "project name"],
  unitNumber: ["unit", "kode unit", "nomor unit", "nomor", "unit number", "no unit", "no. unit"],
  unitDetail: ["description", "detail unit", "detail", "unit detail"],
  cluster: ["klaster", "cluster"],
  pelataranSistem: ["pelataran (data sistem)", "pelataran data sistem", "pelataran"],
  brandName: ["brand name - unit pelataran", "brand", "brand name", "merek"],
  unitType: ["jenis bangunan", "tipe unit", "tipe", "unit type", "type"],
  concernNotes: ["catatan", "catatan audit", "concern", "notes", "keterangan"],
};

function normHeader(s: unknown): string {
  return String(s ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

function findColumn(headerRow: unknown[], aliases: string[]): number {
  const normed = headerRow.map(normHeader);
  for (const a of aliases) {
    const idx = normed.indexOf(a);
    if (idx !== -1) return idx;
  }
  return -1;
}

function isPermissionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "permission-denied"
  );
}

export default function UnitImportPage() {
  const router = useRouter();
  const { user } = useAuditAr();
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);

  const validRows = rows.filter((r) => r.valid && r.data);
  const newCount = validRows.filter((r) => r.isNew).length;
  const updateCount = validRows.filter((r) => r.isNew === false).length;
  const invalidCount = rows.filter((r) => !r.valid).length;

  function parseFile(file: File) {
    setFileName(file.name);
    setAnalyzing(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName =
          workbook.SheetNames.find((n) => normHeader(n) === "data opname") ??
          workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        // Read as a raw matrix so the blank leading row of "Data Opname" doesn't
        // become the header. Keep all rows so indices map to real Excel rows.
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: "",
        });

        const headerRowIdx = matrix.findIndex(
          (row) =>
            Array.isArray(row) &&
            findColumn(row, COLUMN_ALIASES.unitNumber) !== -1 &&
            findColumn(row, COLUMN_ALIASES.projectName) !== -1,
        );
        if (headerRowIdx === -1) {
          setRows([]);
          toast.error("Header tidak ditemukan. Pastikan ada kolom 'Final Project' dan 'Unit'.");
          return;
        }
        const headerRow = matrix[headerRowIdx] as unknown[];
        const cols: Record<StringCol, number> = {
          unitNumber: findColumn(headerRow, COLUMN_ALIASES.unitNumber),
          projectName: findColumn(headerRow, COLUMN_ALIASES.projectName),
          cluster: findColumn(headerRow, COLUMN_ALIASES.cluster),
          unitDetail: findColumn(headerRow, COLUMN_ALIASES.unitDetail),
          pelataranSistem: findColumn(headerRow, COLUMN_ALIASES.pelataranSistem),
          brandName: findColumn(headerRow, COLUMN_ALIASES.brandName),
          unitType: findColumn(headerRow, COLUMN_ALIASES.unitType),
          concernNotes: findColumn(headerRow, COLUMN_ALIASES.concernNotes),
        };
        const flagCols = CONCERN_FLAGS.map((f) => findColumn(headerRow, [f.header]));

        const seen = new Map<string, number>(); // normalized unit -> first row
        const parsed: PreviewRow[] = [];
        matrix.slice(headerRowIdx + 1).forEach((rawRow, i) => {
          const row = Array.isArray(rawRow) ? rawRow : [];
          const rowNum = headerRowIdx + i + 2; // 1-based Excel row number
          const at = (idx: number) => (idx >= 0 ? String(row[idx] ?? "").trim() : "");
          const unitNumber = at(cols.unitNumber);
          const projectName = at(cols.projectName);
          // Skip fully blank rows.
          if (!unitNumber && !projectName && !row.some((c) => String(c ?? "").trim())) {
            return;
          }
          const concernFlags = CONCERN_FLAGS.filter((_, fi) => {
            const v = flagCols[fi] >= 0 ? String(row[flagCols[fi]] ?? "").trim() : "";
            return v === "1" || Number(v) === 1;
          }).map((f) => f.key);
          const candidate = {
            unitNumber,
            projectName,
            cluster: at(cols.cluster),
            unitDetail: at(cols.unitDetail),
            pelataranSistem: at(cols.pelataranSistem).toLowerCase() === "yes",
            brandName: at(cols.brandName),
            unitType: at(cols.unitType),
            concernNotes: at(cols.concernNotes),
            concernFlags,
          };
          const result = auditUnitRowSchema.safeParse(candidate);
          if (!result.success) {
            parsed.push({
              rowNum,
              data: null,
              valid: false,
              error: result.error.issues.map((x) => x.message).join("; "),
            });
            return;
          }
          const key = normalizeUnitNumber(result.data.unitNumber);
          if (seen.has(key)) {
            parsed.push({
              rowNum,
              data: result.data,
              valid: false,
              error: `Duplikat nomor unit (baris ${seen.get(key)})`,
            });
            return;
          }
          seen.set(key, rowNum);
          parsed.push({ rowNum, data: result.data, valid: true });
        });

        // Diff valid rows against existing units.
        const valid = parsed.filter((r) => r.valid && r.data);
        const diff = await diffUnitsAgainstExisting(
          valid.map((r) => r.data as AuditUnitRow),
        );
        for (const r of parsed) {
          if (r.valid && r.data) {
            const entry = diff.find((d) => d.row === r.data);
            r.isNew = entry ? entry.isNew : true;
          }
        }

        setRows(parsed);
        if (parsed.length === 0) toast.error("File kosong atau format tidak sesuai");
      } catch (error) {
        if (isPermissionError(error)) {
          toast.error("Akses Firestore ditolak. Logout lalu login lagi agar role terbaru aktif.");
        } else {
          toast.error("Gagal membaca file. Pastikan format Excel benar.");
        }
      } finally {
        setAnalyzing(false);
      }
    };
    reader.onerror = () => {
      setAnalyzing(false);
      toast.error("Gagal membaca file. Pastikan file bisa diakses browser.");
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleImport() {
    if (validRows.length === 0) {
      toast.error("Tidak ada baris valid untuk diimport");
      return;
    }
    setImporting(true);
    try {
      const entries: UnitDiffEntry[] = (
        await diffUnitsAgainstExisting(validRows.map((r) => r.data as AuditUnitRow))
      );
      const batchId = await createImportRecord({
        importedBy: user?.uid ?? "",
        importedByName: user?.displayName ?? user?.email ?? "",
        fileName,
        newCount,
        updatedCount: updateCount,
        skippedCount: invalidCount,
        totalRows: rows.length,
      });
      await batchUpsertAuditUnits(entries, batchId);
      toast.success(`Import selesai: ${newCount} baru, ${updateCount} diperbarui`);
      router.push("/audit-ar/supervisor/units");
    } catch {
      toast.error("Gagal mengimport master data");
      setImporting(false);
    }
  }

  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      [
        "Final Project",
        "Unit",
        "Description",
        "Klaster",
        "Pelataran (Data Sistem)",
        "Brand Name - Unit Pelataran",
        "Unit dengan AR tidak di FU / sulit dihubungi / tidak ada respon",
        "Unit dengan AR full unpaid / long outstanding",
        "Unit konfirmasi yang tidak masuk unit POM",
        "Identifikasi eksistensi unit pelataran",
        "Selisih pelataran",
        "Unit pelataran - gap period rent",
        "Terdapat Water tanpa Service Charge",
        "Terdapat Service Charge tanpa Water",
        "Jenis Bangunan",
        "Catatan",
      ],
      [
        "BGM - PIK",
        "AG1/001",
        "AKASIA GOLF 1 NO. 001",
        "AKASIA GOLF",
        "No",
        "N.A.",
        "0",
        "0",
        "1",
        "0",
        "0",
        "0",
        "0",
        "0",
        "Rumah",
        "Cek apakah unit ini kavling tanah atau bangunan.",
      ],
    ]);
    ws["!cols"] = [
      { wch: 14 }, // Final Project
      { wch: 12 }, // Unit
      { wch: 24 }, // Description
      { wch: 16 }, // Klaster
      { wch: 12 }, // Pelataran (Data Sistem)
      { wch: 16 }, // Brand
      ...Array.from({ length: 8 }, () => ({ wch: 10 })), // 8 flag columns
      { wch: 16 }, // Jenis Bangunan
      { wch: 48 }, // Catatan
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data Opname");
    XLSX.writeFile(wb, "template-data-opname-audit-ar.xlsx");
  }

  function reset() {
    setRows([]);
    setFileName("");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/audit-ar/supervisor/units")}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            Import Master Data
          </h1>
          <p className="text-sm text-muted-foreground">
            Unit baru ditambahkan, unit yang sudah ada akan diperbarui.
          </p>
        </div>
      </div>

      {rows.length === 0 && (
        <Card className="border-border/50">
          <CardContent className="p-0">
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) parseFile(file);
              }}
              className={cn(
                "flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed p-12 cursor-pointer transition-colors",
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
              )}
            >
              {analyzing ? (
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
              ) : (
                <UploadCloud className="h-12 w-12 text-muted-foreground" />
              )}
              <div className="text-center">
                <p className="font-medium">Drag & drop file atau klik untuk memilih</p>
                <p className="text-sm text-muted-foreground mt-1">Format: .xlsx, .xls</p>
              </div>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) parseFile(file);
                }}
                className="hidden"
              />
            </label>
            <div className="flex justify-center border-t p-4">
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-1.5" />
                Download Template
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{fileName}</p>
              <p className="text-xs text-muted-foreground">{rows.length} baris</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <span>
                <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{newCount}</span>{" "}
                <span className="text-muted-foreground">baru</span>
              </span>
              <span>
                <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">{updateCount}</span>{" "}
                <span className="text-muted-foreground">diperbarui</span>
              </span>
              {invalidCount > 0 && (
                <span>
                  <span className="font-semibold tabular-nums text-destructive">{invalidCount}</span>{" "}
                  <span className="text-muted-foreground">error</span>
                </span>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border/50 overflow-auto max-h-[460px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Baris</TableHead>
                  <TableHead className="w-10" />
                  <TableHead>Nomor Unit</TableHead>
                  <TableHead>Proyek</TableHead>
                  <TableHead>Cluster</TableHead>
                  <TableHead className="w-14">Flag</TableHead>
                  <TableHead className="w-24">Aksi</TableHead>
                  <TableHead>Catatan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.rowNum} className={cn(!r.valid && "bg-destructive/5")}>
                    <TableCell className="text-muted-foreground">{r.rowNum}</TableCell>
                    <TableCell>
                      {r.valid ? (
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{r.data?.unitNumber || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.data?.projectName || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.data?.cluster || "-"}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {r.data ? r.data.concernFlags.length || "-" : "-"}
                    </TableCell>
                    <TableCell>
                      {r.valid ? (
                        r.isNew ? (
                          <Badge variant="outline" className="text-emerald-600 border-emerald-500/30">Baru</Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-600 border-amber-500/30">Update</Badge>
                        )
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {r.error && <p className="text-xs text-destructive">{r.error}</p>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={reset} disabled={importing}>
              Pilih File Lain
            </Button>
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button disabled={importing || validRows.length === 0}>
                    {importing ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <UploadCloud className="h-4 w-4 mr-1.5" />
                    )}
                    Import {validRows.length} unit
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Konfirmasi import master data</AlertDialogTitle>
                  <AlertDialogDescription>
                    {newCount} unit baru akan ditambahkan dan{" "}
                    <span className="font-semibold text-foreground">
                      {updateCount} unit yang sudah ada akan diperbarui (data master ditimpa)
                    </span>
                    . Status audit, draft, dan riwayat unit yang diperbarui tetap dipertahankan. Lanjutkan?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <AlertDialogAction onClick={handleImport}>Ya, Import</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </>
      )}
    </div>
  );
}
