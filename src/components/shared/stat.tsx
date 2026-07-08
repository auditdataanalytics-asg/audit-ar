import { cn } from "@/lib/utils";

// Typographic stat: the number leads, the label is quiet. No icon, no tinted box.
export function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  accent?: "primary" | "positive" | "negative" | "warning";
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

export function StatGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("grid gap-x-8 gap-y-7", className)}>{children}</div>;
}
