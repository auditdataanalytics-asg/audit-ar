import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

// Supervisor-only: list users so a supervisor can assign Audit AR roles.
export async function GET(request: NextRequest) {
  try {
    const adminAuth = getAdminAuth();

    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.split("Bearer ")[1];
    const decoded = await adminAuth.verifyIdToken(token);

    const db = getAdminDb();
    const callerSnap = await db.collection("users").doc(decoded.uid).get();
    const callerAudit = callerSnap.data()?.modules?.auditAr;
    if (!callerSnap.exists || !callerAudit?.enabled || callerAudit.role !== "supervisor") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const snap = await db.collection("users").orderBy("displayName").get();
    const users = snap.docs.map((d) => {
      const data = d.data();
      return {
        uid: data.uid ?? d.id,
        displayName: data.displayName ?? "",
        email: data.email ?? "",
        auditRole: data.modules?.auditAr?.enabled
          ? (data.modules.auditAr.role ?? null)
          : null,
      };
    });

    return NextResponse.json({ users });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}
