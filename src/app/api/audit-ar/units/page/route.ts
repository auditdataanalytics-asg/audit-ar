import { NextRequest, NextResponse } from "next/server";
import type { Query } from "firebase-admin/firestore";

import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { normalizeUnitNumber } from "@/lib/audit-ar/unit-id";
import {
  DEFAULT_PAGE_SIZE,
  isPaginationPageSize,
} from "@/lib/audit-ar/pagination";
import {
  UNIT_AUDIT_STATUSES,
  type AuditUnitListItem,
  type UnitAuditStatus,
} from "@/lib/audit-ar/types";

function isAuditStatus(value: unknown): value is UnitAuditStatus {
  return typeof value === "string" && UNIT_AUDIT_STATUSES.includes(value as UnitAuditStatus);
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
    const auditRole = callerAudit?.enabled ? callerAudit.role : decoded.auditRole;
    if (auditRole !== "supervisor" && auditRole !== "fieldAudit") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      page?: unknown;
      pageSize?: unknown;
      search?: unknown;
      statusFilter?: unknown;
    };
    const requestedPage =
      typeof body.page === "number" && Number.isInteger(body.page) && body.page > 0
        ? body.page
        : 1;
    const pageSize = isPaginationPageSize(body.pageSize)
      ? body.pageSize
      : DEFAULT_PAGE_SIZE;
    const statusFilter = isAuditStatus(body.statusFilter) ? body.statusFilter : "all";
    const search = typeof body.search === "string" ? normalizeUnitNumber(body.search) : "";

    let filteredQuery: Query = db.collection("auditUnits");
    if (statusFilter !== "all") {
      filteredQuery = filteredQuery.where("status", "==", statusFilter);
    }
    if (search) {
      filteredQuery = filteredQuery
        .where("unitNumberNorm", ">=", search)
        .where("unitNumberNorm", "<", `${search}\uf8ff`);
    }

    const countSnapshot = await filteredQuery.count().get();
    const total = countSnapshot.data().count;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const snapshot = await filteredQuery
      .orderBy("unitNumberNorm")
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .get();

    const units: AuditUnitListItem[] = snapshot.docs.map((document) => {
      const data = document.data();
      return {
        id: document.id,
        unitNumber: data.unitNumber ?? "",
        projectName: data.projectName ?? "",
        cluster: data.cluster ?? "",
        unitDetail: data.unitDetail ?? "",
        pelataranSistem: data.pelataranSistem === true,
        brandName: data.brandName ?? "",
        unitType: data.unitType ?? "",
        concernNotes: data.concernNotes ?? "",
        concernFlags: Array.isArray(data.concernFlags) ? data.concernFlags : [],
        status: data.status ?? "not_started",
        currentSubmissionId: data.currentSubmissionId ?? null,
        submissionCount: Number(data.submissionCount ?? 0),
        driveFolderId: data.driveFolderId ?? null,
      };
    });

    return NextResponse.json({ units, page, pageSize, total, totalPages });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gagal memuat halaman unit" },
      { status: 500 },
    );
  }
}
