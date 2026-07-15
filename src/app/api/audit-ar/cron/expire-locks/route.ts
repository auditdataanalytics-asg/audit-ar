import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { cronAuthorized, sweepDecision } from "@/lib/audit-ar/lock-expiry";

// Secondary safety net for abandoned draft locks (lazy expiry on access is the
// primary mechanism). Sweeps units whose lock has genuinely expired so dashboard
// counts stay honest. Invoked by Vercel Cron (see vercel.json).
//
// Lock validity is server-authoritative: a lock is valid while
// `lockedAt + LOCK_TTL_MS` is in the future, judged here with admin server time.
// (The old route read a `lockExpiresAt` field that no longer exists, so it wiped
// every live draft lock on each run — see Threat 6.)
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!cronAuthorized(process.env.CRON_SECRET, authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();

  // Only draft/rejected units can carry a stale lock. Small set; the expiry cut
  // is applied per-doc below (no composite index needed for a single-field `in`).
  const snap = await db
    .collection("auditUnits")
    .where("status", "in", ["draft", "rejected"])
    .get();

  let reset = 0;
  for (const d of snap.docs) {
    const lockedAtMs = d.data().lock?.lockedAt?.toMillis?.() ?? null;
    // Cheap pre-filter with the scan-time snapshot; the transaction re-checks.
    if (!sweepDecision(d.data().status as string, lockedAtMs, Date.now())) continue;

    // Per-doc transaction: re-read and only sweep if STILL expired against fresh
    // server time, so a lock renewed between the scan and now is never clobbered.
    const cleared = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(d.ref);
      if (!fresh.exists) return false;
      const data = fresh.data()!;
      const freshLockMs = data.lock?.lockedAt?.toMillis?.() ?? null;
      const decision = sweepDecision(data.status as string, freshLockMs, Date.now());
      if (!decision) return false;
      tx.update(d.ref, { ...decision, updatedAt: Timestamp.now() });
      return true;
    });
    if (cleared) reset++;
  }

  return NextResponse.json({ reset, scanned: snap.size });
}
