import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";

// Secondary safety net for abandoned draft locks (lazy expiry on access is the
// primary mechanism). Resets drafts whose lock has expired back to not_started
// so dashboard counts stay honest. Invoked by Vercel Cron (see vercel.json).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  const nowMs = Date.now();

  // Draft units only (a small set); filter expired locks in code to avoid a
  // dedicated composite index.
  const snap = await db.collection("auditUnits").where("status", "==", "draft").get();
  const expired = snap.docs.filter((d) => {
    const exp = d.data().lock?.lockExpiresAt as Timestamp | undefined;
    return !exp || exp.toMillis() < nowMs;
  });

  let reset = 0;
  for (let i = 0; i < expired.length; i += 500) {
    const batch = db.batch();
    for (const d of expired.slice(i, i + 500)) {
      batch.update(d.ref, {
        status: "not_started",
        lock: null,
        updatedAt: Timestamp.now(),
      });
      reset++;
    }
    await batch.commit();
  }

  return NextResponse.json({ reset, scanned: snap.size });
}
