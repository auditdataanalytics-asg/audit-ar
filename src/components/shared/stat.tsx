import { cn } from "@/lib/utils";

// Typographic stat: the number leads, the label is quiet. No icon, no tinted box.
export function Stat({
  label,
  value,
  accent,
  className,
}: {
  label: string;
  value: React.ReactNode;
  accent?: "primary" | "positive" | "negative" | "warning";
  className?: string;
}) {
  const accentClass =
    accent === "primary"
      ? "text-primary"
      : accent === "positive"
        ? "text-emerald-600 dark:text-emerald-400"
        : accent === "negative"
          ? "text-destructive"
          : accent === "warning"
            ? "text-amber-600 dark:text-amber-400"
            : "text-foreground";
  return (
    <div className={className}>
      <div className={cn("text-3xl font-semibold tracking-tight tabular-nums", accentClass)}>
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
