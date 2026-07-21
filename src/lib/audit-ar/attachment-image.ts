import type { AuditAttachment } from "@/lib/audit-ar/types";

export function driveImageUrl(fileId: string, size: number): string {
  return `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=s${size}`;
}

function resizedThumbnailUrl(url: string, size: number): string {
  return url.replace(/=s\d+(?:-[a-z0-9]+)*$/i, `=s${size}`);
}

export function attachmentImageSources(
  attachment: Pick<AuditAttachment, "fileId" | "thumbnailLink">,
  size: number,
): string[] {
  const fallback = driveImageUrl(attachment.fileId, size);
  const thumbnail = attachment.thumbnailLink
    ? resizedThumbnailUrl(attachment.thumbnailLink, size)
    : null;

  return thumbnail && thumbnail !== fallback ? [thumbnail, fallback] : [fallback];
}
