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
import { useAuditAr } from "@/lib/audit-ar/hooks/use-audit-ar";
import { cn } from "@/lib/utils";

interface PreviewRow {
  rowNum: number;
  data: AuditUnitRow | null;
  valid: boolean;
  error?: string;
  isNew?: boolean;
}

const HEADER_ALIASES: Record<keyof AuditUnitRow, string[]> = {
  unitNumber: ["nomor unit", "nomor", "unit", "unit number", "no unit", "no. unit"],
  projectName: ["nama proyek", "proyek", "project", "project name"],
  unitDetail: ["detail unit", "detail", "unit detail"],
  customerName: ["customer", "nama customer", "customer name", "pelanggan"],
  brandName: ["brand", "brand name", "merek"],
  unitType: ["tipe unit", "tipe", "unit type", "type"],
  concernNotes: ["catatan audit", "catatan", "concern", "audit concern notes", "notes", "keterangan"],
};

function pick(
  row: Record<string, unknown>,
  keys: string[],
  field: keyof AuditUnitRow,
  posIndex: number,
): string {
  const lowerMap = new Map<string, string>();
  for (const k of keys) lowerMap.set(k.toLowerCase().trim(), k);
  for (const alias of HEADER_ALIASES[field]) {
    const realKey = lowerMap.get(alias);
    if (realKey !== undefined) return String(row[realKey] ?? "").trim();
  }
  // positional fallback
  const byPos = keys[posIndex];
  return byPos !== undefined ? String(row[byPos] ?? "").trim() : "";
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
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: "",
        });

        const seen = new Map<string, number>(); // normalized unit -> first row
        const parsed: PreviewRow[] = json.map((row, i) => {
          const keys = Object.keys(row);
          const candidate = {
            unitNumber: pick(row, keys, "unitNumber", 0),
            projectName: pick(row, keys, "projectName", 1),
            unitDetail: pick(row, keys, "unitDetail", 2),
            customerName: pick(row, keys, "customerName", 3),
            brandName: pick(row, keys, "brandName", 4),
            unitType: pick(row, keys, "unitType", 5),
            concernNotes: pick(row, keys, "concernNotes", 6),
          };
          const result = auditUnitRowSchema.safeParse(candidate);
          if (!result.success) {
            return {
              rowNum: i + 2,
              data: null,
              valid: false,
              error: result.error.issues.map((x) => x.message).join("; "),
            };
          }
          const norm = normalizeUnitNumber(result.data.unitNumber);
          if (seen.has(norm)) {
            return {
              rowNum: i + 2,
              data: result.data,
              valid: false,
              error: `Duplikat nomor unit (baris ${seen.get(norm)})`,
            };
          }
          seen.set(norm, i + 2);
          return { rowNum: i + 2, data: result.data, valid: true };
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
      } catch {
        toast.error("Gagal membaca file. Pastikan format Excel benar.");
      } finally {
        setAnalyzing(false);
      }
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
        "Nomor Unit",
        "Nama Proyek",
        "Detail Unit",
        "Customer",
        "Brand",
        "Tipe Unit",
        "Catatan Audit",
      ],
      [
        "BLOK-A/12",
        "Green Residence",
        "Lantai 2, hadap timur",
        "PT Maju Jaya",
        "Greenpark",
        "Ruko",
        "Cek apakah unit ini kavling tanah atau bangunan.",
      ],
    ]);
    ws["!cols"] = [
      { wch: 16 },
      { wch: 20 },
      { wch: 24 },
      { wch: 20 },
      { wch: 16 },
      { wch: 14 },
      { wch: 48 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Master Data");
    XLSX.writeFile(wb, "template-master-data-audit-ar.xlsx");
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
