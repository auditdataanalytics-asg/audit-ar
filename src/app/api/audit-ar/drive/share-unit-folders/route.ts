import { NextRequest, NextResponse } from "next/server";

import { ensureFolderAnyoneWithLink } from "@/lib/audit-ar/google/drive";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

const MAX_UNIT_IDS = 50;
const DRIVE_CONCURRENCY = 5;

async function shareWithLimitedConcurrency(folderIds: string[]): Promise<void> {
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < folderIds.length) {
      const folderId = folderIds[nextIndex];
      nextIndex += 1;
      await ensureFolderAnyoneWithLink(folderId);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(DRIVE_CONCURRENCY, folderIds.length) },
      () => worker(),
    ),
  );
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(authHeader.slice("Bearer ".length));
    const db = getAdminDb();
    const callerSnap = await db.collection("users").doc(decoded.uid).get();
    const callerAudit = callerSnap.data()?.modules?.auditAr;
    if (!callerSnap.exists || !callerAudit?.enabled || callerAudit.role !== "supervisor") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as { unitIds?: unknown };
    const unitIds = Array.isArray(body.unitIds)
      ? Array.from(
          new Set(
            body.unitIds.filter(
              (unitId): unitId is string => typeof unitId === "string" && unitId.length > 0,
            ),
          ),
        )
      : [];

    if (unitIds.length > MAX_UNIT_IDS) {
      return NextResponse.json(
        { error: `Maksimal ${MAX_UNIT_IDS} unit per permintaan` },
        { status: 400 },
      );
    }
    if (unitIds.length === 0) {
      return NextResponse.json({ shared: 0 });
    }

    const unitSnapshots = await db.getAll(
      ...unitIds.map((unitId) => db.collection("auditUnits").doc(unitId)),
    );
    const folderIds = Array.from(
      new Set(
        unitSnapshots
          .map((snapshot) => snapshot.data()?.driveFolderId)
          .filter(
            (folderId): folderId is string =>
              typeof folderId === "string" && folderId.length > 0,
          ),
      ),
    );

    await shareWithLimitedConcurrency(folderIds);
    return NextResponse.json({ shared: folderIds.length });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gagal memperbarui akses folder Google Drive",
      },
      { status: 500 },
    );
  }
}
