import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { ensureUnitFolder, uploadFile } from "@/lib/audit-ar/google/drive";
import { slugifyUnitNumber } from "@/lib/audit-ar/unit-id";

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

export async function POST(request: NextRequest) {
  try {
    const adminAuth = getAdminAuth();
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = await adminAuth.verifyIdToken(authHeader.split("Bearer ")[1]);

    const form = await request.formData();
    const file = form.get("file");
    const unitId = String(form.get("unitId") ?? "");
    const fieldKey = String(form.get("fieldKey") ?? "attachment");
    const version = String(form.get("version") ?? "1");

    if (!(file instanceof Blob) || !unitId) {
      return NextResponse.json({ error: "Missing file or unitId" }, { status: 400 });
    }

    const db = getAdminDb();
    const unitRef = db.collection("auditUnits").doc(unitId);
    const unitSnap = await unitRef.get();
    if (!unitSnap.exists) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }
    const unit = unitSnap.data()!;

    // Caller must currently own the draft lock on this unit.
    const lock = unit.lock;
    const lockLive = lock && lock.lockExpiresAt?.toMillis?.() > Date.now();
    if (!lockLive || lock.lockedBy !== decoded.uid) {
      return NextResponse.json({ error: "Unit not locked by you" }, { status: 403 });
    }

    // Ensure the per-unit Drive folder (cache its id on the unit).
    let folderId: string = unit.driveFolderId;
    if (!folderId) {
      folderId = await ensureUnitFolder(unit.projectName ?? "", unit.unitNumber ?? unitId);
      await unitRef.update({ driveFolderId: folderId });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "image/jpeg";
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const slug = slugifyUnitNumber(unit.unitNumber ?? unitId) || "unit";
    const name = `${slug}__v${version}__${fieldKey}__${timestamp()}.${ext}`;

    const uploaded = await uploadFile(folderId, buffer, mimeType, name);

    return NextResponse.json({
      fileId: uploaded.fileId,
      webViewLink: uploaded.webViewLink,
      thumbnailLink: uploaded.thumbnailLink,
      fileName: name,
      mimeType,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Upload failed" },
      { status: 500 },
    );
  }
}
