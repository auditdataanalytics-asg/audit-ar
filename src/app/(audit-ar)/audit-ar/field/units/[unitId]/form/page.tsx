"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, ChevronLeft, ImageIcon, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Timestamp } from "firebase/firestore";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
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
  PLT_STATUS_LABELS,
  type AuditUnitDoc,
  type AuditCategoryDoc,
  type AuditAttachment,
  type OccupancyStatus,
  type PltStatus,
} from "@/lib/audit-ar/types";
import { compressImage } from "@/lib/audit-ar/google/image-compress";

const PHOTO_LABEL_OTHER = "other";
const PHOTO_LABEL_OPTIONS = OCCUPANCY_PHOTO_FIELDS.map((f) => ({
  value: f.key,
  label: f.label,
}));

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
  const [loadedAt, setLoadedAt] = useState(0);

  // form state
  const [occupancy, setOccupancy] = useState<OccupancyStatus | "">("");
  const [pltStatus, setPltStatus] = useState<PltStatus | "">("");
  const [pltNotes, setPltNotes] = useState("");
  const [conditionId, setConditionId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [attachments, setAttachments] = useState<AuditAttachment[]>([]);
  const [photoLabelKey, setPhotoLabelKey] = useState(PHOTO_LABEL_OPTIONS[0]?.value ?? "");
  const [customPhotoLabel, setCustomPhotoLabel] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const ownsLock = useMemo(() => {
    return (
      !!unit?.lock &&
      unit.lock.lockedBy === user?.uid &&
      unit.lock.lockExpiresAt.toMillis() > loadedAt
    );
  }, [loadedAt, unit, user?.uid]);

  useAuditLockHeartbeat(unitId, user?.uid ?? null, ownsLock && !submitting);

  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      if (!unitId) return;
      try {
        const [u, cond, typ] = await Promise.all([
          getAuditUnit(unitId),
          getCategories("buildingCondition"),
          getCategories("buildingType"),
        ]);
        if (cancelled) return;
        setUnit(u);
        setConditions(cond.filter((c) => c.isActive));
        setTypes(typ.filter((c) => c.isActive));
        setLoadedAt(Date.now());
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [unitId]);

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
      pltStatus,
      pltNotes,
      buildingConditionId: conditionId,
      buildingTypeId: typeId,
      remarks,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (attachments.length === 0) {
      toast.error("Minimal 1 foto wajib diunggah");
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
          pltExists: parsed.data.pltStatus === "exists",
          pltStatus: parsed.data.pltStatus,
          pltNotes: parsed.data.pltNotes,
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

  const selectedPhotoOption = PHOTO_LABEL_OPTIONS.find((o) => o.value === photoLabelKey);
  const selectedPhotoLabel =
    photoLabelKey === PHOTO_LABEL_OTHER
      ? customPhotoLabel.trim()
      : (selectedPhotoOption?.label ?? "");

  async function handlePhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file || !unit || !user) return;
    const label = selectedPhotoLabel;
    if (!label) {
      toast.error("Pilih atau isi label foto dulu");
      input.value = "";
      return;
    }

    const fieldPrefix =
      photoLabelKey === PHOTO_LABEL_OTHER ? "photo-other" : photoLabelKey || "photo";
    const fieldKey = `${fieldPrefix}-${Date.now()}`;

    setUploadingPhoto(true);
    try {
      const blob = await compressImage(file);
      const token = await user.getIdToken();
      const fd = new FormData();
      fd.append("file", blob, `${fieldKey}.jpg`);
      fd.append("unitId", unit.id);
      fd.append("fieldKey", fieldKey);
      fd.append("version", String(unit.submissionCount + 1));

      const res = await fetch("/api/audit-ar/attachments/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "upload failed");
      }

      const data = await res.json();
      setAttachments((prev) => [
        ...prev,
        {
          key: fieldKey,
          label,
          required: false,
          fileId: data.fileId,
          webViewLink: data.webViewLink,
          thumbnailLink: data.thumbnailLink,
          fileName: data.fileName,
          mimeType: data.mimeType,
          uploadedAt: Timestamp.now(),
          uploadedBy: user.uid,
          editableAfterSubmit: false,
        },
      ]);
      if (photoLabelKey === PHOTO_LABEL_OTHER) setCustomPhotoLabel("");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error &&
          err.message === "Google Drive is not configured (missing GOOGLE_OAUTH_* env vars)."
          ? "Google Drive belum dikonfigurasi"
          : "Gagal mengunggah foto",
      );
    } finally {
      setUploadingPhoto(false);
      input.value = "";
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!unit) return null;

  const selectedCondition = conditions.find((c) => c.id === conditionId);
  const selectedType = types.find((c) => c.id === typeId);

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
          <Label>
            Status Hunian
            <RequiredMark />
          </Label>
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
            <Label>
              Foto Indikator Hunian
              <RequiredMark />
            </Label>
            <p className="text-xs text-muted-foreground">
              Minimal 1 foto. Kamu bisa upload beberapa foto dengan label masing-masing.
            </p>
          </div>

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePhotoFile}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoFile}
          />

          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={photoLabelKey} onValueChange={(v) => setPhotoLabelKey(v ?? "")}>
                <SelectTrigger className="h-11 w-full">
                  <span
                    className={
                      selectedPhotoOption || photoLabelKey === PHOTO_LABEL_OTHER
                        ? ""
                        : "text-muted-foreground"
                    }
                  >
                    {photoLabelKey === PHOTO_LABEL_OTHER
                      ? "Lainnya"
                      : (selectedPhotoOption?.label ?? "Pilih label foto")}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {PHOTO_LABEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={PHOTO_LABEL_OTHER}>Lainnya</SelectItem>
                </SelectContent>
              </Select>
              {photoLabelKey === PHOTO_LABEL_OTHER && (
                <Input
                  value={customPhotoLabel}
                  onChange={(e) => setCustomPhotoLabel(e.target.value)}
                  placeholder="Isi label foto"
                  className="h-11"
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={uploadingPhoto || !selectedPhotoLabel}
                onClick={() => photoInputRef.current?.click()}
              >
                {uploadingPhoto ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="mr-1.5 h-4 w-4" />
                )}
                Kamera
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={uploadingPhoto || !selectedPhotoLabel}
                onClick={() => galleryInputRef.current?.click()}
              >
                <ImageIcon className="mr-1.5 h-4 w-4" />
                Galeri
              </Button>
            </div>
          </div>

          {attachments.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Belum ada foto.
            </p>
          ) : (
            <div className="space-y-2">
              {attachments.map((attachment) => (
                <div key={attachment.key} className="flex items-center gap-3 rounded-lg border p-2">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                    {attachment.thumbnailLink ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={attachment.thumbnailLink}
                        alt={attachment.label}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{attachment.label}</p>
                    <p className="text-xs text-muted-foreground">Terunggah</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() =>
                      setAttachments((prev) =>
                        prev.filter((item) => item.key !== attachment.key),
                      )
                    }
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* PLT / building condition / type */}
      <Card className="border-border/50">
        <CardContent className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label>
              PLT / Pelataran
              <RequiredMark />
            </Label>
            <Select value={pltStatus} onValueChange={(v) => setPltStatus((v as PltStatus) ?? "")}>
              <SelectTrigger className="h-11 w-full">
                <span className={pltStatus ? "" : "text-muted-foreground"}>
                  {pltStatus ? PLT_STATUS_LABELS[pltStatus] : "Pilih PLT / pelataran"}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="exists">Ada PLT</SelectItem>
                <SelectItem value="not_exists">Tidak ada PLT</SelectItem>
                <SelectItem value="other">Lainnya</SelectItem>
              </SelectContent>
            </Select>
            {pltStatus === "other" && (
              <Input
                value={pltNotes}
                onChange={(e) => setPltNotes(e.target.value)}
                placeholder="Isi keterangan lainnya"
                className="h-11"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label>
              Kondisi Bangunan
              <RequiredMark />
            </Label>
            <Select value={conditionId} onValueChange={(v) => setConditionId(v ?? "")}>
              <SelectTrigger className="h-11 w-full">
                <span className={selectedCondition ? "" : "text-muted-foreground"}>
                  {selectedCondition?.label ?? "Pilih kondisi"}
                </span>
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
            <Label>
              Tipe Bangunan
              <RequiredMark />
            </Label>
            <Select value={typeId} onValueChange={(v) => setTypeId(v ?? "")}>
              <SelectTrigger className="h-11 w-full">
                <span className={selectedType ? "" : "text-muted-foreground"}>
                  {selectedType?.label ?? "Pilih tipe"}
                </span>
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

      {/* Remarks */}
      <Card className="border-border/50">
        <CardContent className="p-4">
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

function RequiredMark() {
  return <span className="ml-1 text-destructive">*</span>;
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
      className={`flex min-h-[3.25rem] cursor-pointer items-center justify-center text-balance rounded-lg border px-2 py-3 text-center text-sm font-medium leading-tight transition-colors ${
        active ? "border-primary bg-primary/10 text-primary" : "border-border"
      }`}
    >
      <RadioGroupItem id={`occ-${value}`} value={value} className="sr-only" />
      {label}
    </Label>
  );
}
