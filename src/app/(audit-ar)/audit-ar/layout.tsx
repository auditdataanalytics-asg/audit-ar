import { AuditArGuard } from "@/components/audit-ar/audit-ar-guard";

export default function AuditArLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuditArGuard>{children}</AuditArGuard>;
}
