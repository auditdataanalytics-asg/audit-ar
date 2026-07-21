"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, X, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Timestamp } from "firebase/firestore";

import { Button } from "@/components/ui/button";
import { AuditPhotoImage } from "@/components/audit-ar/audit-photo-image";
import { useAuditAr } from "@/lib/audit-ar/hooks/use-audit-ar";
import { compressImage } from "@/lib/audit-ar/google/image-compress";
import type { AuditAttachment } from "@/lib/audit-ar/types";

interface AttachmentFieldProps {
  unitId: string;
  fieldKey: string;
  label: string;
  required: boolean;
  version: number;
  value: AuditAttachment | null;
  onChange: (attachment: AuditAttachment | null) => void;
}

export function AttachmentField({
  unitId,
  fieldKey,
  label,
  required,
  version,
  value,
  onChange,
}: AttachmentFieldProps) {
  const { user } = useAuditAr();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const blob = await compressImage(file);
      const localUrl = URL.createObjectURL(blob);
      setPreview(localUrl);

      const token = await user.getIdToken();
      const fd = new FormData();
      fd.append("file", blob, `${fieldKey}.jpg`);
      fd.append("unitId", unitId);
      fd.append("fieldKey", fieldKey);
      fd.append("version", String(version));

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
      onChange({
        key: fieldKey,
        label,
        required,
        fileId: data.fileId,
        webViewLink: data.webViewLink,
        thumbnailLink: data.thumbnailLink,
        fileName: data.fileName,
        mimeType: data.mimeType,
        uploadedAt: Timestamp.now(),
        uploadedBy: user.uid,
        editableAfterSubmit: fieldKey.startsWith("extra"),
      });
    } catch (error: unknown) {
      toast.error(error instanceof Error && error.message === "Google Drive is not configured (missing GOOGLE_OAUTH_* env vars)."
        ? "Google Drive belum dikonfigurasi"
        : "Gagal mengunggah foto");
      setPreview(null);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFile}
      />
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={label} className="h-full w-full object-cover" />
        ) : value ? (
          <AuditPhotoImage
            key={value.fileId}
            attachment={value}
            size={200}
            alt={label}
            className="h-full w-full object-cover"
            placeholderClassName="[&_svg]:hidden text-[0px]"
          />
        ) : (
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {value ? "Terunggah" : "Belum ada foto"}
        </p>
      </div>
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => {
            onChange(null);
            setPreview(null);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <Camera className="mr-1.5 h-4 w-4" />
          Foto
        </Button>
      )}
    </div>
  );
}
