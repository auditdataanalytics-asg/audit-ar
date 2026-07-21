import * as XLSX from "xlsx";

export function driveFolderUrl(folderId: string | null | undefined): string {
  const normalizedFolderId = folderId?.trim();
  return normalizedFolderId
    ? `https://drive.google.com/drive/folders/${encodeURIComponent(normalizedFolderId)}`
    : "";
}

export function addUrlHyperlinks(
  worksheet: XLSX.WorkSheet,
  rows: ReadonlyArray<Record<string, unknown>>,
  columnName: string,
  tooltip: string,
): void {
  if (rows.length === 0) return;

  const columnIndex = Object.keys(rows[0]).indexOf(columnName);
  if (columnIndex < 0) return;

  rows.forEach((row, rowIndex) => {
    const target = row[columnName];
    if (typeof target !== "string" || target.length === 0) return;

    const cellAddress = XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex + 1 });
    const cell = worksheet[cellAddress];
    if (cell) cell.l = { Target: target, Tooltip: tooltip };
  });
}
