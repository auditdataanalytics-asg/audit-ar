import { describe, expect, it } from "vitest";

import {
  attachmentImageSources,
  driveImageUrl,
} from "@/lib/audit-ar/attachment-image";

describe("audit attachment preview URLs", () => {
  it("builds a Drive CDN fallback when thumbnailLink is missing", () => {
    expect(
      attachmentImageSources({ fileId: "drive_file-123", thumbnailLink: null }, 720),
    ).toEqual(["https://lh3.googleusercontent.com/d/drive_file-123=s720"]);
  });

  it("tries a resized Drive thumbnail before the file-id fallback", () => {
    expect(
      attachmentImageSources(
        {
          fileId: "drive-file-456",
          thumbnailLink: "https://lh3.googleusercontent.com/example=s220",
        },
        1600,
      ),
    ).toEqual([
      "https://lh3.googleusercontent.com/example=s1600",
      "https://lh3.googleusercontent.com/d/drive-file-456=s1600",
    ]);
  });

  it("encodes unusual file ids", () => {
    expect(driveImageUrl("file id", 200)).toBe(
      "https://lh3.googleusercontent.com/d/file%20id=s200",
    );
  });
});
