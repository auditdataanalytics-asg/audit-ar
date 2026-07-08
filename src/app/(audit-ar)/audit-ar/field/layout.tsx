"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { AuditArGuard } from "@/components/audit-ar/audit-ar-guard";
import { FieldBottomNav } from "@/components/audit-ar/field-bottom-nav";
import { signOut } from "@/lib/firebase/auth";
import { useAuditAr } from "@/lib/audit-ar/hooks/use-audit-ar";

export default function FieldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isSupervisor } = useAuditAr();

  async function handleSignOut() {
    try {
      await signOut();
      router.push("/login");
    } catch {
      toast.error("Gagal keluar");
    }
  }

  return (
    <AuditArGuard requireRole="fieldAudit">
      <div className="flex min-h-screen flex-col bg-muted/20">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <Link href="/" className="font-heading text-sm font-semibold hover:text-primary">
            Audit AR
          </Link>
          <div className="ml-auto flex items-center gap-1">
            {isSupervisor && (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                nativeButton={false}
                render={<Link href="/audit-ar/supervisor" />}
              >
                Supervisor
              </Button>
            )}
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Keluar">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4">{children}</main>
        <FieldBottomNav />
      </div>
    </AuditArGuard>
  );
}
