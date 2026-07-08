"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { AttachmentField } from "@/components/audit-ar/attachment-field";
import { useAuditAr } from "@/lib/audit-ar/hooks/use-audit-ar";
import { useAuditLockHeartbeat } from "@/lib/audit-ar/hooks/use-audit-lock";
import {
  getAuditUnit,
  getCategories,
  createSubmission,
  releaseDraftLock,
} from "@/lib/audit-ar/firestore";
import { auditSubmissionSchema } from "@/lib/audit-ar/validators";
import {
  OCCUPANCY_PHOTO_FIELDS,
  type AuditUnitDoc,
  type AuditCategoryDoc,
  type AuditAttachment,
  type OccupancyStatus,
} from "@/lib/audit-ar/types";

export default function FieldAuditFormPage() {
  const router = useRouter();
  const params = useParams<{ unitId: string }>();
  const unitId = params.unitId;
  const { user } = useAuditAr();

  const [unit, setUnit] = useState<AuditUnitDoc | null>(null);
  const [conditions, setConditions] = useState<AuditCategoryDoc[]>([]);
  const [types, setTypes] = useState<AuditCategoryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // form state
  const [occupancy, setOccupancy] = useState<OccupancyStatus | "">("");
  const [pltExists, setPltExists] = useState(false);
  const [conditionId, setConditionId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [attachments, setAttachments] = useState<AuditAttachment[]>([]);

  const ownsLock = useMemo(() => {
    const now = Date.now();
    return (
      !!unit?.lock &&
      unit.lock.lockedBy === user?.uid &&
      unit.lock.lockExpiresAt.toMillis() > now
    );
  }, [unit, user?.uid]);

  useAuditLockHeartbeat(unitId, user?.uid ?? null, ownsLock && !submitting);

  const load = useCallback(async () => {
    if (!unitId) return;
    const [u, cond, typ] = await Promise.all([
      getAuditUnit(unitId),
      getCategories("buildingCondition"),
      getCategories("buildingType"),
    ]);
    setUnit(u);
    setConditions(cond.filter((c) => c.isActive));
    setTypes(typ.filter((c) => c.isActive));
    setLoading(false);
  }, [unitId]);

  useEffect(() => {
    load();
  }, [load]);

  // Redirect out if the lock isn't ours (someone else took it / it expired).
  useEffect(() => {
    if (loading || !unit || !user) return;
    const now = Date.now();
    const mine =
      !!unit.lock && unit.lock.lockedBy === user.uid && unit.lock.lockExpiresAt.toMillis() > now;
    if (!mine) {
      toast.error("Kunci draft tidak aktif. Mulai ulang dari halaman unit.");
      router.replace(`/audit-ar/field/units/${unit.id}`);
    }
  }, [loading, unit, user, router]);

  async function handleSubmit() {
    if (!unit || !user) return;
    const parsed = auditSubmissionSchema.safeParse({
      occupancyStatus: occupancy,
      pltExists,
      buildingConditionId: conditionId,
      buildingTypeId: typeId,
      remarks,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const requiredMissing = OCCUPANCY_PHOTO_FIELDS.filter(
      (f) => f.required && !attachments.some((a) => a.key === f.key),
    );
    if (requiredMissing.length > 0) {
      toast.error(`Foto wajib belum lengkap: ${requiredMissing.map((f) => f.label).join(", ")}`);
      return;
    }

    setSubmitting(true);
    try {
      const condition = conditions.find((c) => c.id === conditionId);
      const type = types.find((c) => c.id === typeId);
      await createSubmission(
        unit,
        user.uid,
        user.displayName || user.email || "Auditor",
        {
          occupancyStatus: parsed.data.occupancyStatus,
          pltExists: parsed.data.pltExists,
          buildingConditionId: conditionId,
          buildingConditionLabel: condition?.label ?? "",
          buildingTypeId: typeId,
          buildingTypeLabel: type?.label ?? "",
          remarks: parsed.data.remarks,
          attachments,
        },
      );
      toast.success("Audit terkirim untuk review");
      router.replace(`/audit-ar/field/units/${unit.id}`);
    } catch {
      toast.error("Gagal mengirim audit");
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!unit || !user) return;
    await releaseDraftLock(unit.id, user.uid);
    router.replace(`/audit-ar/field/units/${unit.id}`);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!unit) return null;

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-heading text-lg font-bold">Form Audit</h1>
          <p className="truncate text-sm text-muted-foreground">
            {unit.unitNumber} · {unit.projectName}
          </p>
        </div>
      </div>

      {/* Occupancy */}
      <Card className="border-border/50">
        <CardContent className="space-y-3 p-4">
          <Label>Status Hunian</Label>
          <RadioGroup
            value={occupancy}
            onValueChange={(v) => setOccupancy(v as OccupancyStatus)}
            className="grid grid-cols-2 gap-2"
          >
            <OccupancyOption value="occupied" label="Berpenghuni" current={occupancy} />
            <OccupancyOption value="not_occupied" label="Tidak berpenghuni" current={occupancy} />
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Occupancy indicator photos */}
      <Card className="border-border/50">
        <CardContent className="space-y-4 p-4">
          <div>
            <Label>Foto Indikator Hunian</Label>
            <p className="text-xs text-muted-foreground">
              Ambil foto sebagai bukti kondisi hunian.
            </p>
          </div>
          {OCCUPANCY_PHOTO_FIELDS.map((f) => (
            <AttachmentField
              key={f.key}
              unitId={unit.id}
              fieldKey={f.key}
              label={f.label}
              required={f.required}
              version={unit.submissionCount + 1}
              value={attachments.find((a) => a.key === f.key) ?? null}
              onChange={(att) =>
                setAttachments((prev) => {
                  const rest = prev.filter((a) => a.key !== f.key);
                  return att ? [...rest, att] : rest;
                })
              }
            />
          ))}
        </CardContent>
      </Card>

      {/* PLT / building condition / type */}
      <Card className="border-border/50">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="plt">PLT / Pelataran ada?</Label>
            <Switch id="plt" checked={pltExists} onCheckedChange={setPltExists} />
          </div>

          <div className="space-y-1.5">
            <Label>Kondisi Bangunan</Label>
            <Select value={conditionId} onValueChange={(v) => setConditionId(v ?? "")}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Pilih kondisi" />
              </SelectTrigger>
              <SelectContent>
                {conditions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Tipe Bangunan</Label>
            <Select value={typeId} onValueChange={(v) => setTypeId(v ?? "")}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="Pilih tipe" />
              </SelectTrigger>
              <SelectContent>
                {types.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Remarks + extra attachments */}
      <Card className="border-border/50">
        <CardContent className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="remarks">Catatan (opsional)</Label>
            <Textarea
              id="remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Kondisi khusus, dll."
              rows={3}
            />
          </div>
          <AttachmentField
            unitId={unit.id}
            fieldKey="extra"
            label="Lampiran tambahan (opsional)"
            required={false}
            version={unit.submissionCount + 1}
            value={attachments.find((a) => a.key.startsWith("extra")) ?? null}
            onChange={(att) =>
              setAttachments((prev) => {
                const rest = prev.filter((a) => !a.key.startsWith("extra"));
                return att ? [...rest, { ...att, key: "extra-1" }] : rest;
              })
            }
          />
        </CardContent>
      </Card>

      {/* Sticky submit bar */}
      <div className="fixed inset-x-0 bottom-16 z-10 border-t bg-background/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg gap-2">
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="outline" className="h-11" disabled={submitting}>
                  <X className="h-4 w-4" />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Batalkan draft?</AlertDialogTitle>
                <AlertDialogDescription>
                  Isian yang belum dikirim akan hilang dan unit kembali tersedia untuk auditor lain.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Lanjut Isi</AlertDialogCancel>
                <AlertDialogAction onClick={handleCancel}>Ya, Batalkan</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button className="h-11 flex-1" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-4 w-4" />
            )}
            Kirim untuk Review
          </Button>
        </div>
      </div>
    </div>
  );
}

function OccupancyOption({
  value,
  label,
  current,
}: {
  value: OccupancyStatus;
  label: string;
  current: string;
}) {
  const active = current === value;
  return (
    <Label
      htmlFor={`occ-${value}`}
      className={`flex cursor-pointer items-center justify-center rounded-lg border p-3 text-sm font-medium transition-colors ${
        active ? "border-primary bg-primary/10 text-primary" : "border-border"
      }`}
    >
      <RadioGroupItem id={`occ-${value}`} value={value} className="sr-only" />
      {label}
    </Label>
  );
}
