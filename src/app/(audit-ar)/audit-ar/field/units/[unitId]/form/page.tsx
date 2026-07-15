"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, ChevronLeft, ImageIcon, Loader2, Send, Trash2, X } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuditAr } from "@/lib/audit-ar/hooks/use-audit-ar";
import { useAuditLockHeartbeat } from "@/lib/audit-ar/hooks/use-audit-lock";
import {
  getCategories,
  createSubmission,
  saveDraft,
  deleteDraft,
  deleteAttachmentFiles,
  subscribeAuditUnit,
} from "@/lib/audit-ar/firestore";
import { isLockOwnedLive } from "@/lib/audit-ar/lock-expiry";
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

// Public Drive files render directly from the CDN by id (works immediately after
// upload, before Drive has generated its own thumbnailLink).
function driveImageUrl(fileId: string, size: number): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=s${size}`;
}

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
  const [pltStatus, setPltStatus] = useState<PltStatus | "">("");
  const [pltNotes, setPltNotes] = useState("");
  const [conditionId, setConditionId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [attachments, setAttachments] = useState<AuditAttachment[]>([]);
  const [photoLabelKey, setPhotoLabelKey] = useState(PHOTO_LABEL_OPTIONS[0]?.value ?? "");
  const [customPhotoLabel, setCustomPhotoLabel] = useState("");
  // A counter (not a boolean) so concurrent uploads are all tracked; submit is
  // blocked while any upload is in flight (Threat 3).
  const [pendingUploads, setPendingUploads] = useState(0);
  const uploadingPhoto = pendingUploads > 0;
  const photoInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<AuditAttachment | null>(null);
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const hydratedRef = useRef(false);
  // Re-entrancy guard: blocks a second submit dispatched before React re-renders
  // the disabled button (physical double-tap).
  const submittingRef = useRef(false);
  // Set true when we navigate away on purpose (submit / delete draft), so the
  // lock-loss redirect below doesn't fire on our own intentional lock clear.
  const leavingRef = useRef(false);
  // Threat 8: don't setState/persist after unmount, abort in-flight uploads, and
  // revoke object-URL previews on unmount.
  const mountedRef = useRef(true);
  const uploadAbortRef = useRef<Set<AbortController>>(new Set());
  const localPreviewsRef = useRef<Record<string, string>>({});

  // Owner match, re-derived whenever the unit snapshot changes (Threat 5). Kept
  // clock-free so it's pure in render; server-authoritative TTL validity is
  // enforced by the heartbeat, the redirect effect below, and saveDraft.
  const ownsLock = useMemo(
    () => !!unit?.lock && unit.lock.lockedBy === user?.uid,
    [unit, user?.uid],
  );

  useAuditLockHeartbeat(unitId, user?.uid ?? null, ownsLock && !submitting);

  const redirectLockLost = useCallback(() => {
    if (leavingRef.current) return; // already navigating away
    leavingRef.current = true;
    toast.error("Kunci draft tidak aktif. Mulai ulang dari halaman unit.");
    router.replace(`/audit-ar/field/units/${unitId}`);
  }, [router, unitId]);

  // Category lists — fetched once (they don't change during an edit session).
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getCategories("buildingCondition"),
      getCategories("buildingType"),
    ]).then(([cond, typ]) => {
      if (cancelled) return;
      setConditions(cond.filter((c) => c.isActive));
      setTypes(typ.filter((c) => c.isActive));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live unit subscription — a lock takeover / expiry sweep / clear is seen
  // immediately instead of frozen at mount (Threat 5).
  useEffect(() => {
    if (!unitId) return;
    const unsub = subscribeAuditUnit(
      unitId,
      (u) => {
        setUnit(u);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [unitId]);

  // Keep a live mirror of the object-URL previews so unmount cleanup revokes them.
  useEffect(() => {
    localPreviewsRef.current = localPreviews;
  }, [localPreviews]);

  // Unmount: mark unmounted, abort in-flight uploads, revoke object URLs so an
  // upload that resolves after we leave can't revive the draft or leak memory.
  useEffect(() => {
    mountedRef.current = true;
    const aborters = uploadAbortRef.current;
    return () => {
      mountedRef.current = false;
      aborters.forEach((c) => c.abort());
      aborters.clear();
      Object.values(localPreviewsRef.current).forEach((url) =>
        URL.revokeObjectURL(url),
      );
    };
  }, []);

  // Redirect out if the lock isn't ours (someone else took it / it expired /
  // the cron swept it). Not during our own submit or intentional leave.
  useEffect(() => {
    if (loading || !unit || !user || submitting || leavingRef.current) return;
    const mine = isLockOwnedLive(
      unit.lock?.lockedBy,
      unit.lock?.lockedAt?.toMillis(),
      user.uid,
      Date.now(),
    );
    if (!mine) redirectLockLost();
  }, [loading, unit, user, submitting, redirectLockLost]);

  // Hydrate the form from a previously saved draft (owned by this user).
  useEffect(() => {
    if (hydratedRef.current || !unit || !user) return;
    const d = unit.draft;
    if (d && d.updatedBy === user.uid) {
      setOccupancy(d.occupancyStatus ?? "");
      setPltStatus(d.pltStatus ?? "");
      setPltNotes(d.pltNotes ?? "");
      setConditionId(d.buildingConditionId ?? "");
      setTypeId(d.buildingTypeId ?? "");
      setRemarks(d.remarks ?? "");
      setAttachments(d.attachments ?? []);
    }
    hydratedRef.current = true;
  }, [unit, user]);

  const persistDraft = useCallback(
    async (attachmentsSnapshot: AuditAttachment[]) => {
      if (!unit || !user) return;
      const res = await saveDraft(unit.id, user.uid, {
        occupancyStatus: occupancy,
        pltStatus,
        pltNotes,
        buildingConditionId: conditionId,
        buildingTypeId: typeId,
        remarks,
        attachments: attachmentsSnapshot,
      });
      // A lost lock (silent TTL expiry the snapshot can't observe) surfaces here
      // rather than failing silently and losing the auditor's input (Threat 5).
      if (!res.ok && res.reason === "not_locked") redirectLockLost();
    },
    [
      unit,
      user,
      occupancy,
      pltStatus,
      pltNotes,
      conditionId,
      typeId,
      remarks,
      redirectLockLost,
    ],
  );

  // Auto-save the draft (debounced) whenever the form changes, once hydrated.
  useEffect(() => {
    if (!hydratedRef.current || !ownsLock || submitting) return;
    const t = setTimeout(() => void persistDraft(attachments), 800);
    return () => clearTimeout(t);
  }, [
    occupancy,
    pltStatus,
    pltNotes,
    conditionId,
    typeId,
    remarks,
    attachments,
    ownsLock,
    submitting,
    persistDraft,
  ]);

  async function handleSubmit() {
    if (!unit || !user) return;
    if (submittingRef.current) return; // re-entrancy guard (double-tap)
    if (uploadingPhoto) {
      // A photo is still uploading; submitting now would snapshot `attachments`
      // before it lands (Threat 3). The button is also disabled, but this guards
      // the click that races the re-render.
      toast.error("Tunggu foto selesai diunggah");
      return;
    }
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

    submittingRef.current = true;
    setSubmitting(true);
    let navigated = false;
    try {
      const condition = conditions.find((c) => c.id === conditionId);
      const type = types.find((c) => c.id === typeId);
      const res = await createSubmission(
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
      if (res.ok) {
        toast.success("Audit terkirim untuk review");
        navigated = true;
        leavingRef.current = true; // our own lock clear — don't trip the redirect
        router.replace(`/audit-ar/field/units/${unit.id}`);
      } else if (res.reason === "already_submitted") {
        // A duplicate submit (double-tap / retry) — the audit is already in review.
        toast.info("Audit ini sudah terkirim");
        navigated = true;
        leavingRef.current = true;
        router.replace(`/audit-ar/field/units/${unit.id}`);
      } else {
        toast.error("Gagal mengirim audit");
      }
    } catch {
      toast.error("Gagal mengirim audit");
    } finally {
      // Keep the button disabled while navigating away on success; otherwise reset
      // so the auditor can retry a genuine failure.
      if (!navigated) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  }

  async function handleDeleteDraft() {
    if (!unit || !user) return;
    leavingRef.current = true; // our own lock clear — don't trip the redirect
    try {
      // Remove the draft's Drive photos first, while we still own the lock/draft
      // that authorizes it — deleteDraft below clears both (Threat 7).
      await deleteAttachmentFiles(unit.id, attachments);
      await deleteDraft(unit.id, user.uid);
      toast.success("Draft dihapus");
      router.replace(`/audit-ar/field/units/${unit.id}`);
    } catch {
      leavingRef.current = false; // stay on the form; keep watching the lock
      toast.error("Gagal menghapus draft");
    }
  }

  async function removeAttachment(attachment: AuditAttachment) {
    const next = attachments.filter((item) => item.key !== attachment.key);
    setAttachments(next);
    void persistDraft(next);
    // Revoke the local preview and drop it from the map.
    const url = localPreviews[attachment.key];
    if (url) {
      URL.revokeObjectURL(url);
      setLocalPreviews((p) => {
        const rest = { ...p };
        delete rest[attachment.key];
        return rest;
      });
    }
    // Best-effort remove the Drive file so it doesn't orphan (Threat 7).
    if (unit) void deleteAttachmentFiles(unit.id, [attachment]);
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

    const controller = new AbortController();
    uploadAbortRef.current.add(controller);
    setPendingUploads((n) => n + 1);
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
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "upload failed");
      }

      const data = await res.json();
      // Bail if we unmounted mid-upload: touching state here would revive a draft
      // the submission just cleared (Threat 8).
      if (!mountedRef.current) return;
      const nextAttachment: AuditAttachment = {
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
      };
      const next = [...attachments, nextAttachment];
      setAttachments(next);
      setLocalPreviews((p) => ({ ...p, [fieldKey]: URL.createObjectURL(blob) }));
      void persistDraft(next);
      if (photoLabelKey === PHOTO_LABEL_OTHER) setCustomPhotoLabel("");
    } catch (err: unknown) {
      // An abort is our own unmount cleanup — not a user-facing failure.
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(
        err instanceof Error &&
          err.message === "Google Drive is not configured (missing GOOGLE_OAUTH_* env vars)."
          ? "Google Drive belum dikonfigurasi"
          : "Gagal mengunggah foto",
      );
    } finally {
      uploadAbortRef.current.delete(controller);
      if (mountedRef.current) {
        setPendingUploads((n) => n - 1);
        input.value = "";
      }
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
                  <button
                    type="button"
                    onClick={() => setPreview(attachment)}
                    aria-label="Pratinjau foto"
                    className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={localPreviews[attachment.key] ?? driveImageUrl(attachment.fileId, 200)}
                      alt={attachment.label}
                      className="h-full w-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreview(attachment)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-sm font-medium">{attachment.label}</p>
                    <p className="text-xs text-muted-foreground">Ketuk untuk pratinjau</p>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => void removeAttachment(attachment)}
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
                <Button
                  variant="outline"
                  className="h-11 text-destructive"
                  disabled={submitting || uploadingPhoto}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Hapus draft?</AlertDialogTitle>
                <AlertDialogDescription>
                  Semua isian dan foto yang sudah diunggah untuk draft ini akan dihapus permanen.
                  Tindakan ini tidak bisa dibatalkan.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Batal</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteDraft}>Hapus Draft</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            className="h-11 flex-1"
            onClick={handleSubmit}
            disabled={submitting || uploadingPhoto}
          >
            {submitting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-4 w-4" />
            )}
            {uploadingPhoto ? "Menunggu foto..." : "Kirim untuk Review"}
          </Button>
        </div>
      </div>

      {/* Photo preview lightbox */}
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">{preview?.label}</DialogTitle>
          </DialogHeader>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={localPreviews[preview.key] ?? driveImageUrl(preview.fileId, 1200)}
              alt={preview.label}
              className="max-h-[70vh] w-full rounded-md object-contain"
            />
          )}
          {preview?.webViewLink && (
            <a
              href={preview.webViewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              Buka ukuran penuh di Drive
            </a>
          )}
        </DialogContent>
      </Dialog>
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
      className={`relative flex h-14 cursor-pointer items-center justify-center text-balance rounded-lg border px-2 text-center text-sm font-medium leading-tight transition-colors ${
        active ? "border-primary bg-primary/10 text-primary" : "border-border"
      }`}
    >
      <RadioGroupItem
        id={`occ-${value}`}
        value={value}
        className="absolute size-0 opacity-0"
      />
      {label}
    </Label>
  );
}
