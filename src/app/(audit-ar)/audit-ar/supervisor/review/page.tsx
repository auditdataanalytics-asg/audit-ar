"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, ChevronRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { getPendingReviewUnits } from "@/lib/audit-ar/firestore";
import { formatRelative } from "@/lib/shared/date-format";
import type { AuditUnitDoc } from "@/lib/audit-ar/types";

export default function ReviewQueuePage() {
  const [units, setUnits] = useState<AuditUnitDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Reads only pending units, not the whole collection.
    getPendingReviewUnits()
      .then(setUnits)
      .finally(() => setLoading(false));
  }, []);

  const pending = useMemo(
    () =>
      [...units].sort(
        (a, b) =>
          (a.lastSubmittedAt?.toMillis() ?? 0) - (b.lastSubmittedAt?.toMillis() ?? 0),
      ),
    [units],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Review Audit</h1>
        <p className="text-sm text-muted-foreground">
          {pending.length} audit menunggu persetujuan.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : pending.length === 0 ? (
        <EmptyState title="Tidak ada audit yang menunggu review" />
      ) : (
        <div className="space-y-2">
          {pending.map((u) => (
            <Link key={u.id} href={`/audit-ar/supervisor/units/${u.id}`}>
              <Card className="border-border/50 transition-colors hover:bg-muted/40">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{u.unitNumber}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {u.projectName}
                      {u.lastSubmittedAt && ` · dikirim ${formatRelative(u.lastSubmittedAt.toDate())}`}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
