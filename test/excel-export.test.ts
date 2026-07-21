import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { addUrlHyperlinks, driveFolderUrl } from "@/lib/audit-ar/excel-export";

describe("audit Excel export", () => {
  it("builds one Drive folder URL for a unit", () => {
    expect(driveFolderUrl("folder_123")).toBe(
      "https://drive.google.com/drive/folders/folder_123",
    );
    expect(driveFolderUrl(null)).toBe("");
  });

  it("makes the Foto Audit cell a clickable hyperlink", () => {
    const rows = [
      {
        "Nomor Unit": "UNIT-01",
        "Foto Audit": driveFolderUrl("folder_123"),
      },
    ];
    const worksheet = XLSX.utils.json_to_sheet(rows);

    addUrlHyperlinks(worksheet, rows, "Foto Audit", "Buka folder");

    expect(worksheet.B2?.l).toEqual({
      Target: "https://drive.google.com/drive/folders/folder_123",
      Tooltip: "Buka folder",
    });
  });
});
