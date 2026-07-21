"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, Loader2, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge, STATUS_LABELS } from "@/components/audit-ar/status-badge";
import { DataPagination } from "@/components/audit-ar/data-pagination";
import { getAuditUnitsNumberedPage } from "@/lib/audit-ar/firestore";
import {
  UNIT_AUDIT_STATUSES,
  type AuditUnitListItem,
  type UnitAuditStatus,
} from "@/lib/audit-ar/types";
import { cn } from "@/lib/utils";

export default function FieldUnitsPage() {
  const [units, setUnits] = useState<AuditUnitListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<UnitAuditStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [pageTotal, setPageTotal] = useState(0);

  // Load page 1 on filter/search change (search debounced). Only the current
  // page is read + rendered — never the whole collection.
  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      setLoading(true);
      getAuditUnitsNumberedPage({ statusFilter, search, page, pageSize })
        .then((result) => {
          if (!active) return;
          setUnits(result.units);
          setPageTotal(result.total);
          if (result.page !== page) setPage(result.page);
        })
        .catch((error) => {
          if (active) {
            toast.error(
              error instanceof Error ? `Gagal memuat unit: ${error.message}` : "Gagal memuat unit",
            );
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [statusFilter, search, page, pageSize]);

  return (
    <div className="space-y-4">
      <div className="sticky top-14 -mx-4 space-y-3 bg-muted/20 px-4 pb-3 pt-1">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari nomor unit (awalan)..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="h-11 pl-9"
          />
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
          <Chip
            label="Semua"
            active={statusFilter === "all"}
            onClick={() => {
              setStatusFilter("all");
              setPage(1);
            }}
          />
          {UNIT_AUDIT_STATUSES.map((s) => (
            <Chip
              key={s}
              label={STATUS_LABELS[s]}
              active={statusFilter === s}
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
            />
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
          <div className="pt-2">
            <DataPagination
              page={page}
              pageSize={pageSize}
              totalItems={pageTotal}
              onPageChange={setPage}
              onPageSizeChange={(nextPageSize) => {
                setPageSize(nextPageSize);
                setPage(1);
              }}
            />
          </div>
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
