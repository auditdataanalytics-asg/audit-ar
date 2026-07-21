import { Readable } from "node:stream";
import { drive as makeDrive, type drive_v3 } from "@googleapis/drive";
import { getDriveAuthProvider } from "./drive-auth";

let _drive: drive_v3.Drive | null = null;

async function getDrive(): Promise<drive_v3.Drive> {
  if (_drive) return _drive;
  const auth = await getDriveAuthProvider().getAuthClient();
  // google-auth-library types differ between the app copy and the one nested in
  // googleapis-common; the runtime clients are compatible, so cast past it.
  _drive = makeDrive({ version: "v3", auth: auth as never });
  return _drive;
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findOrCreateFolder(name: string, parentId?: string): Promise<string> {
  const drive = await getDrive();
  const parentClause = parentId ? `'${parentId}' in parents` : `'root' in parents`;
  const q = `name='${escapeQuery(name)}' and mimeType='application/vnd.google-apps.folder' and ${parentClause} and trashed=false`;
  const res = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1 });
  const existing = res.data.files?.[0]?.id;
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id",
  });
  if (!created.data.id) throw new Error("Failed to create Drive folder");
  return created.data.id;
}

/**
 * Ensure `AuditAR/{project}/{unit}` exists and return the unit folder id.
 * AUDIT_AR_DRIVE_ROOT_FOLDER_ID is optional: if set it's the parent of AuditAR;
 * otherwise (recommended with the drive.file scope) AuditAR is created at the
 * Drive root and the app manages it.
 */
export async function ensureUnitFolder(
  projectName: string,
  unitNumber: string,
): Promise<string> {
  const configuredRoot = process.env.AUDIT_AR_DRIVE_ROOT_FOLDER_ID;
  const appFolder = await findOrCreateFolder("AuditAR", configuredRoot || undefined);
  const projectFolder = await findOrCreateFolder(projectName || "Tanpa Proyek", appFolder);
  const unitFolder = await findOrCreateFolder(unitNumber, projectFolder);
  await ensureFolderAnyoneWithLink(unitFolder);
  return unitFolder;
}

/** Ensure a unit folder can be viewed by anyone who has its link. */
export async function ensureFolderAnyoneWithLink(folderId: string): Promise<void> {
  const drive = await getDrive();
  const permissions = await drive.permissions.list({
    fileId: folderId,
    fields: "permissions(id,type,role)",
    supportsAllDrives: true,
  });

  if (permissions.data.permissions?.some((permission) => permission.type === "anyone")) {
    return;
  }

  await drive.permissions.create({
    fileId: folderId,
    supportsAllDrives: true,
    requestBody: {
      type: "anyone",
      role: "reader",
      allowFileDiscovery: false,
    },
  });
}

/**
 * Best-effort permanent delete of a Drive file by id. Used when a photo is
 * removed from a draft or a draft is discarded, so the Drive file doesn't orphan
 * (Threat 7). Errors are swallowed (the file simply stays) — mirrors the
 * permission-create swallow in uploadFile; callers don't depend on success.
 */
export async function deleteFile(fileId: string): Promise<void> {
  const drive = await getDrive();
  await drive.files.delete({ fileId }).catch(() => {});
}

export interface UploadedFile {
  fileId: string;
  webViewLink: string;
  thumbnailLink: string | null;
}

export async function uploadFile(
  folderId: string,
  buffer: Buffer,
  mimeType: string,
  name: string,
): Promise<UploadedFile> {
  const drive = await getDrive();
  const created = await drive.files.create({
    requestBody: { name, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: "id,webViewLink,thumbnailLink",
  });
  if (!created.data.id) throw new Error("Drive upload failed");

  // Make readable-by-link so the supervisor can preview thumbnails in-app.
  await drive.permissions
    .create({
      fileId: created.data.id,
      requestBody: { role: "reader", type: "anyone" },
    })
    .catch(() => {});

  return {
    fileId: created.data.id,
    webViewLink: created.data.webViewLink ?? "",
    thumbnailLink: created.data.thumbnailLink ?? null,
  };
}
