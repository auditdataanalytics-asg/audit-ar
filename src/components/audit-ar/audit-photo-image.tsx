"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

import { attachmentImageSources } from "@/lib/audit-ar/attachment-image";
import type { AuditAttachment } from "@/lib/audit-ar/types";
import { cn } from "@/lib/utils";

export function AuditPhotoImage({
  attachment,
  size,
  alt,
  className,
  placeholderClassName,
}: {
  attachment: Pick<AuditAttachment, "fileId" | "thumbnailLink">;
  size: number;
  alt: string;
  className?: string;
  placeholderClassName?: string;
}) {
  const sources = attachmentImageSources(attachment, size);
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];

  if (!source) {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-2 bg-muted text-xs text-muted-foreground",
          className,
          placeholderClassName,
        )}
      >
        <ImageOff className="h-4 w-4" />
        Pratinjau tidak tersedia
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={source}
      alt={alt}
      className={className}
      onError={() => setSourceIndex((current) => current + 1)}
    />
  );
}
