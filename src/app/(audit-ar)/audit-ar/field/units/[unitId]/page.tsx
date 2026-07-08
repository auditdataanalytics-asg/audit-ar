"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronLeft,
  Loader2,
  Lock,
  PlayCircle,
  PencilLine,
  RotateCcw,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/audit-ar/status-badge";
import { getAuditUnit, getSubmission, acquireDraftLock } from "@/lib/audit-ar/firestore";
import { useAuditAr } from "@/lib/audit-ar/hooks/use-audit-ar";
import { formatDateTime } from "@/lib/shared/date-format";
import type { AuditUnitDoc, AuditSubmissionDoc } from "@/lib/audit-ar/types";

export default function FieldUnitDetailPage() {
  const router = useRouter();
  const params = useParams<{ unitId: string }>();
  const unitId = params.unitId;
  const { user } = useAuditAr();

  const [unit, setUnit] = useState<AuditUnitDoc | null>(null);
  const [submission, setSubmission] = useState<AuditSubmissionDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [acquiring, setAcquiring] = useState(false);

  const load = useCallback(async () => {
    if (!unitId) return;
    const u = await getAuditUnit(unitId);
    setUnit(u);
    if (u?.currentSubmissionId) {
      setSubmission(await getSubmission(unitId, u.currentSubmissionId));
    } else {
      setSubmission(null);
    }
    setLoading(false);
  }, [unitId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleStart() {
    if (!unit || !user) return;
    setAcquiring(true);
    const res = await acquireDraftLock(
      unit.id,
      user.uid,
      user.displayName || user.email || "Auditor",
    );
    setAcquiring(false);
    if (res.ok) {
      router.push(`/audit-ar/field/units/${unit.id}/form`);
    } else if (res.reason === "locked") {
      toast.error(`Sedang dikerjakan oleh ${res.lockedByName ?? "auditor lain"}`);
      load();
    } else {
      toast.error("Tidak bisa memulai audit unit ini");
      load();
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!unit) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Unit tidak ditemukan.
      </div>
    );
  }

  const now = Date.now();
  const lockLive = !!unit.lock && unit.lock.lockExpiresAt.toMillis() > now;
  const lockedByOther = lockLive && unit.lock?.lockedBy !== user?.uid;
  const lockedByMe = lockLive && unit.lock?.lockedBy === user?.uid;

  const master: [string, string][] = [
    ["Proyek", unit.projectName],
    ["Detail Unit", unit.unitDetail || "-"],
    ["Customer", unit.customerName || "-"],
    ["Brand", unit.brandName || "-"],
    ["Tipe Unit", unit.unitType || "-"],
  ];

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-heading text-lg font-bold">{unit.unitNumber}</h1>
            <StatusBadge status={unit.status} />
          </div>
          <p className="truncate text-sm text-muted-foreground">{unit.projectName}</p>
        </div>
      </div>

      {unit.concernNotes && (
        <div className="border-l-2 border-amber-500/60 pl-3">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
            Catatan Audit
          </p>
          <p className="mt-1 text-sm">{unit.concernNotes}</p>
        </div>
      )}

      {unit.status === "rejected" && submission?.rejectionNote && (
        <div className="border-l-2 border-destructive pl-3">
          <p className="text-xs font-medium uppercase tracking-wide text-destructive">
            Ditolak — perlu revisi
          </p>
          <p className="mt-0.5 text-sm">{submission.rejectionNote}</p>
        </div>
      )}

      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Master Data</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {master.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <span className="text-sm text-muted-foreground">{k}</span>
              <span className="text-right text-sm font-medium">{v}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Submitted result (read-only) for pending/approved */}
      {(unit.status === "pending" || unit.status === "approved") && submission && (
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Hasil Audit Terkirim</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row k="Status Hunian" v={submission.occupancyStatus === "occupied" ? "Berpenghuni" : "Tidak berpenghuni"} />
            <Row k="PLT / Pelataran" v={submission.pltExists ? "Ada" : "Tidak ada"} />
            <Row k="Kondisi Bangunan" v={submission.buildingConditionLabel || "-"} />
            <Row k="Tipe Bangunan" v={submission.buildingTypeLabel || "-"} />
            {submission.remarks && <Row k="Catatan" v={submission.remarks} />}
            {submission.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {submission.attachments.map((a) => (
                  <a
                    key={a.fileId}
                    href={a.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1 text-xs"
                  >
                    {a.label}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ))}
              </div>
            )}
            <p className="pt-1 text-xs text-muted-foreground">
              Dikirim {submission.submittedAt ? formatDateTime(submission.submittedAt.toDate()) : "-"}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Action bar */}
      <div className="sticky bottom-16 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur">
        {lockedByOther ? (
          <Button className="w-full h-11" disabled variant="outline">
            <Lock className="mr-1.5 h-4 w-4" />
            Sedang dikerjakan oleh {unit.lock?.lockedByName}
          </Button>
        ) : unit.status === "pending" || unit.status === "approved" ? (
          <Button className="w-full h-11" disabled variant="outline">
            {unit.status === "pending" ? "Menunggu review supervisor" : "Sudah disetujui"}
          </Button>
        ) : (
          <Button className="w-full h-11" onClick={handleStart} disabled={acquiring}>
            {acquiring ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : unit.status === "rejected" ? (
              <RotateCcw className="mr-1.5 h-4 w-4" />
            ) : lockedByMe ? (
              <PencilLine className="mr-1.5 h-4 w-4" />
            ) : (
              <PlayCircle className="mr-1.5 h-4 w-4" />
            )}
            {unit.status === "rejected"
              ? "Revisi & Kirim Ulang"
              : lockedByMe
                ? "Lanjutkan Draft"
                : "Mulai Audit"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}
