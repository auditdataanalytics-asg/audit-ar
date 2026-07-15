import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { deleteFile } from "@/lib/audit-ar/google/drive";
import { LOCK_TTL_MS } from "@/lib/audit-ar/constants";

// Best-effort removal of a draft photo's Drive file so it doesn't orphan when the
// photo is removed or the draft is discarded (Threat 7). Authorized for the live
// lock owner, the draft owner, or a supervisor (decision D6). A file still
// referenced by an immutable submission is never deleted (history is preserved).
export async function POST(request: NextRequest) {
  try {
    const adminAuth = getAdminAuth();
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = await adminAuth.verifyIdToken(authHeader.split("Bearer ")[1]);

    const body = (await request.json().catch(() => ({}))) as {
      unitId?: string;
      fileId?: string;
    };
    const unitId = body.unitId ?? "";
    const fileId = body.fileId ?? "";
    if (!unitId || !fileId) {
      return NextResponse.json({ error: "Missing unitId or fileId" }, { status: 400 });
    }

    const db = getAdminDb();
    const unitRef = db.collection("auditUnits").doc(unitId);
    const unitSnap = await unitRef.get();
    if (!unitSnap.exists) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }
    const unit = unitSnap.data()!;

    // Authorize: live lock owner OR draft owner OR supervisor (D6).
    const lock = unit.lock;
    const lockLive = lock && lock.lockedAt?.toMillis?.() + LOCK_TTL_MS > Date.now();
    const isLockOwner = !!lockLive && lock.lockedBy === decoded.uid;
    const isDraftOwner = unit.draft?.updatedBy === decoded.uid;
    let isSupervisor = false;
    if (!isLockOwner && !isDraftOwner) {
      const callerAudit = (await db.collection("users").doc(decoded.uid).get()).data()
        ?.modules?.auditAr;
      isSupervisor = !!callerAudit?.enabled && callerAudit.role === "supervisor";
    }
    if (!isLockOwner && !isDraftOwner && !isSupervisor) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Never delete a file an immutable submission still references.
    const subsSnap = await unitRef.collection("submissions").get();
    const referenced = subsSnap.docs.some((d) => {
      const atts = (d.data().attachments ?? []) as { fileId?: string }[];
      return atts.some((a) => a.fileId === fileId);
    });
    if (referenced) {
      return NextResponse.json(
        { error: "File referenced by a submission" },
        { status: 409 },
      );
    }

    await deleteFile(fileId);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 500 },
    );
  }
}
