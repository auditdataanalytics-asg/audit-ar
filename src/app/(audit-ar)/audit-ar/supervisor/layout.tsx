"use client";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AuditArGuard } from "@/components/audit-ar/audit-ar-guard";
import { SupervisorSidebar } from "@/components/audit-ar/supervisor-sidebar";
import { AuditArHeader } from "@/components/audit-ar/audit-ar-header";

export default function SupervisorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuditArGuard requireRole="supervisor">
      <SidebarProvider>
        <SupervisorSidebar />
        <SidebarInset>
          <AuditArHeader />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </AuditArGuard>
  );
}
