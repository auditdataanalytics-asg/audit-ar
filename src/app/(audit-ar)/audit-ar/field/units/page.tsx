"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search, Loader2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge, STATUS_LABELS } from "@/components/audit-ar/status-badge";
import { getAuditUnitsPage } from "@/lib/audit-ar/firestore";
import { UNIT_AUDIT_STATUSES, type AuditUnitDoc, type UnitAuditStatus } from "@/lib/audit-ar/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

export default function FieldUnitsPage() {
  const [units, setUnits] = useState<AuditUnitDoc[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<UnitAuditStatus | "all">("all");

  // Load page 1 on filter/search change (search debounced). Only the current
  // page is read + rendered — never the whole collection.
  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      setLoading(true);
      getAuditUnitsPage({ statusFilter, search, pageSize: PAGE_SIZE })
        .then((page) => {
          if (!active) return;
          setUnits(page.units);
          setCursor(page.cursor);
          setHasMore(page.hasMore);
        })
        .catch(() => {
          if (active) toast.error("Gagal memuat unit");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [statusFilter, search]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await getAuditUnitsPage({ statusFilter, search, cursor, pageSize: PAGE_SIZE });
      setUnits((prev) => [...prev, ...page.units]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch {
      toast.error("Gagal memuat lebih banyak");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, statusFilter, search]);

  return (
    <div className="space-y-4">
      <div className="sticky top-14 -mx-4 space-y-3 bg-muted/20 px-4 pb-3 pt-1">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari nomor unit (awalan)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 pl-9"
          />
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          <Chip label="Semua" active={statusFilter === "all"} onClick={() => setStatusFilter("all")} />
          {UNIT_AUDIT_STATUSES.map((s) => (
            <Chip key={s} label={STATUS_LABELS[s]} active={statusFilter === s} onClick={() => setStatusFilter(s)} />
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : units.length === 0 ? (
        <EmptyState title="Tidak ada unit" />
      ) : (
        <div className="space-y-2">
          {units.map((u) => (
            <Link key={u.id} href={`/audit-ar/field/units/${u.id}`}>
              <Card className="border-border/50 transition-colors active:bg-muted/50">
                <CardContent className="flex items-center gap-3 p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{u.unitNumber}</p>
                    <p className="truncate text-sm text-muted-foreground">{u.projectName}</p>
                  </div>
                  <StatusBadge status={u.status} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Muat lebih banyak
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      className={cn("h-8 shrink-0 rounded-full text-xs")}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
