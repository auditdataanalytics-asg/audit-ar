import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

const VALID_ROLES = ["supervisor", "fieldAudit"] as const;

// Supervisors manage their own team: a caller must be an Audit AR supervisor to
// grant or revoke Audit AR roles. Claims are merged so the LMS `role` is kept.
export async function POST(request: NextRequest) {
  try {
    const adminAuth = getAdminAuth();

    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.split("Bearer ")[1];
    const decoded = await adminAuth.verifyIdToken(token);

    // Caller must be an Audit AR supervisor (checked against Firestore doc).
    const db = getAdminDb();
    const callerSnap = await db.collection("users").doc(decoded.uid).get();
    const callerAudit = callerSnap.data()?.modules?.auditAr;
    if (!callerSnap.exists || !callerAudit?.enabled || callerAudit.role !== "supervisor") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // role === null revokes Audit AR access.
    const { uid, role } = (await request.json()) as {
      uid?: string;
      role?: string | null;
    };

    if (!uid || (role !== null && !VALID_ROLES.includes(role as never))) {
      return NextResponse.json({ error: "Invalid uid or role" }, { status: 400 });
    }

    const auditRole = role ?? null;

    // Merge custom claims (preserve LMS `role`).
    const target = await adminAuth.getUser(uid);
    await adminAuth.setCustomUserClaims(uid, {
      ...(target.customClaims ?? {}),
      auditRole,
    });

    await db.collection("users").doc(uid).set(
      {
        modules: {
          auditAr: {
            enabled: auditRole !== null,
            role: auditRole,
            grantedAt: FieldValue.serverTimestamp(),
            grantedBy: decoded.uid,
          },
        },
      },
      { merge: true },
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}
