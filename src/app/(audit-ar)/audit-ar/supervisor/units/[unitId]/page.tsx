"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Loader2, ExternalLink, Check, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { Textarea } from "@/components/ui/textarea";
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
import { StatusBadge } from "@/components/audit-ar/status-badge";
import { getAuditUnit, getSubmissions, reviewSubmission } from "@/lib/audit-ar/firestore";
import { useAuditAr } from "@/lib/audit-ar/hooks/use-audit-ar";
import { formatDateTime } from "@/lib/shared/date-format";
import {
  formatPltStatus,
  type AuditUnitDoc,
  type AuditSubmissionDoc,
} from "@/lib/audit-ar/types";

export default function SupervisorUnitDetailPage() {
  const router = useRouter();
  const params = useParams<{ unitId: string }>();
  const unitId = params.unitId;
  const { user } = useAuditAr();
  const [unit, setUnit] = useState<AuditUnitDoc | null>(null);
  const [submissions, setSubmissions] = useState<AuditSubmissionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [rejectNote, setRejectNote] = useState("");

  const load = useCallback(async () => {
    if (!unitId) return;
    const u = await getAuditUnit(unitId);
    setUnit(u);
    if (u) setSubmissions(await getSubmissions(unitId));
    setLoading(false);
  }, [unitId]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      if (!unitId) return;
      try {
        const u = await getAuditUnit(unitId);
        if (cancelled) return;
        setUnit(u);
        if (u) {
          const nextSubmissions = await getSubmissions(unitId);
          if (cancelled) return;
          setSubmissions(nextSubmissions);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [unitId]);

  const reviewerName = user?.displayName || user?.email || "Supervisor";

  async function handleApprove() {
    if (!unit || !unit.currentSubmissionId || !user) return;
    setReviewing(true);
    try {
      const res = await reviewSubmission(unit, unit.currentSubmissionId, "approved", user.uid, reviewerName);
      if (res.ok) {
        toast.success("Audit disetujui");
      } else if (res.reason === "already_reviewed") {
        toast.info("Audit ini sudah direview supervisor lain");
      } else {
        toast.error("Gagal menyetujui");
      }
      await load();
    } catch {
      toast.error("Gagal menyetujui");
    } finally {
      setReviewing(false);
    }
  }

  async function handleReject() {
    if (!unit || !unit.currentSubmissionId || !user) return;
    const note = rejectNote.trim();
    if (!note) {
      toast.error("Alasan penolakan wajib diisi");
      return;
    }
    setReviewing(true);
    try {
      const res = await reviewSubmission(unit, unit.currentSubmissionId, "rejected", user.uid, reviewerName, note);
      if (res.ok) {
        toast.success("Audit ditolak");
        setRejectNote("");
      } else if (res.reason === "already_reviewed") {
        toast.info("Audit ini sudah direview supervisor lain");
      } else {
        toast.error("Gagal menolak");
      }
      await load();
    } catch {
      toast.error("Gagal menolak");
    } finally {
      setReviewing(false);
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
      <div className="mx-auto max-w-2xl py-16 text-center text-sm text-muted-foreground">
        Unit tidak ditemukan.
      </div>
    );
  }

  const master: [string, string][] = [
    ["Proyek", unit.projectName],
    ["Detail Unit", unit.unitDetail || "-"],
    ["Customer", unit.customerName || "-"],
    ["Brand", unit.brandName || "-"],
    ["Tipe Unit", unit.unitType || "-"],
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-2xl font-bold tracking-tight">{unit.unitNumber}</h1>
            <StatusBadge status={unit.status} />
          </div>
          <p className="text-sm text-muted-foreground">{unit.projectName}</p>
        </div>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Master Data</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {master.map(([k, v]) => (
            <div key={k}>
              <p className="text-xs text-muted-foreground">{k}</p>
              <p className="text-sm">{v}</p>
            </div>
          ))}
          {unit.concernNotes && (
            <div className="sm:col-span-2 border-l-2 border-amber-500/60 pl-3">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                Catatan Audit
              </p>
              <p className="mt-1 text-sm">{unit.concernNotes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 font-heading text-sm font-semibold">
          Riwayat Audit ({submissions.length})
        </h2>
        {submissions.length === 0 ? (
          <EmptyState title="Belum ada submission untuk unit ini" className="py-8" />
        ) : (
          <div className="space-y-4">
            {submissions.map((s) => (
              <SubmissionCard
                key={s.id}
                submission={s}
                review={
                  s.status === "pending" && s.id === unit.currentSubmissionId
                    ? {
                        reviewing,
                        rejectNote,
                        setRejectNote,
                        onApprove: handleApprove,
                        onReject: handleReject,
                      }
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ReviewActions {
  reviewing: boolean;
  rejectNote: string;
  setRejectNote: (v: string) => void;
  onApprove: () => void;
  onReject: () => void;
}

function SubmissionCard({
  submission: s,
  review,
}: {
  submission: AuditSubmissionDoc;
  review?: ReviewActions;
}) {
  return (
    <Card className={review ? "border-primary/40 bg-primary/5" : "border-border/50"}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm font-medium">
          Versi {s.version}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            oleh {s.submittedByName} · {s.submittedAt ? formatDateTime(s.submittedAt.toDate()) : "-"}
          </span>
        </CardTitle>
        <StatusBadge status={s.status} />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {s.status === "rejected" && s.rejectionNote && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
            <p className="text-xs font-medium text-destructive">Alasan penolakan</p>
            <p className="mt-0.5">{s.rejectionNote}</p>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Status Hunian" value={s.occupancyStatus === "occupied" ? "Berpenghuni" : "Tidak berpenghuni"} />
          <Field
            label="PLT / Pelataran"
            value={formatPltStatus(s.pltStatus, s.pltNotes, s.pltExists)}
          />
          <Field label="Kondisi Bangunan" value={s.buildingConditionLabel || "-"} />
          <Field label="Tipe Bangunan" value={s.buildingTypeLabel || "-"} />
        </div>
        {s.remarks && <Field label="Catatan" value={s.remarks} />}
        {s.attachments.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">
              Lampiran ({s.attachments.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {s.attachments.map((a) => (
                <a
                  key={a.fileId}
                  href={a.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-1 text-xs hover:bg-muted"
                >
                  {a.thumbnailLink ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.thumbnailLink} alt={a.label} className="h-5 w-5 rounded object-cover" />
                  ) : null}
                  {a.label}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          </div>
        )}
        {review && (
          <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium">Tindakan Diperlukan</p>
            <div className="flex gap-2">
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button variant="outline" className="text-destructive" disabled={review.reviewing}>
                      <X className="mr-1.5 h-4 w-4" />
                      Tolak
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Tolak audit ini?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Berikan alasan penolakan agar Field Audit bisa merevisi.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <Textarea
                    value={review.rejectNote}
                    onChange={(e) => review.setRejectNote(e.target.value)}
                    placeholder="Alasan penolakan..."
                    rows={3}
                  />
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={review.onReject}>Tolak Audit</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button onClick={review.onApprove} disabled={review.reviewing}>
                {review.reviewing ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-1.5 h-4 w-4" />
                )}
                Setujui
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  );
}
