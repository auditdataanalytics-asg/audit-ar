import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { UnitAuditStatus } from "@/lib/audit-ar/types";

const STATUS_META: Record<
  UnitAuditStatus,
  { label: string; className: string }
> = {
  not_started: {
    label: "Belum diaudit",
    className: "bg-muted text-muted-foreground border-border",
  },
  draft: {
    label: "Draft",
    className: "bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400",
  },
  pending: {
    label: "Menunggu Review",
    className: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  },
  approved: {
    label: "Disetujui",
    className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  },
  rejected: {
    label: "Ditolak",
    className: "bg-destructive/10 text-destructive border-destructive/20",
  },
};

export const STATUS_LABELS: Record<UnitAuditStatus, string> = {
  not_started: STATUS_META.not_started.label,
  draft: STATUS_META.draft.label,
  pending: STATUS_META.pending.label,
  approved: STATUS_META.approved.label,
  rejected: STATUS_META.rejected.label,
};

export function StatusBadge({
  status,
  className,
}: {
  status: UnitAuditStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <Badge variant="outline" className={cn(meta.className, className)}>
      {meta.label}
    </Badge>
  );
}
