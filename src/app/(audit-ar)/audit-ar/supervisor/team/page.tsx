"use client";

import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuditAr } from "@/lib/audit-ar/hooks/use-audit-ar";

interface TeamUser {
  uid: string;
  displayName: string;
  email: string;
  auditRole: "supervisor" | "fieldAudit" | null;
}

const ROLE_VALUE = { none: "none", supervisor: "supervisor", fieldAudit: "fieldAudit" } as const;

export default function TeamPage() {
  const { user } = useAuditAr();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [savingUid, setSavingUid] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/audit-ar/users", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setUsers(data.users);
      } catch {
        toast.error("Gagal memuat daftar pengguna");
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  async function changeRole(target: TeamUser, value: string) {
    if (!user) return;
    const role = value === ROLE_VALUE.none ? null : value;
    setSavingUid(target.uid);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/audit-ar/set-role", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ uid: target.uid, role }),
      });
      if (!res.ok) throw new Error();
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === target.uid
            ? { ...u, auditRole: (role as TeamUser["auditRole"]) ?? null }
            : u,
        ),
      );
      toast.success(`Role ${target.displayName || target.email} diperbarui`);
    } catch {
      toast.error("Gagal memperbarui role");
    } finally {
      setSavingUid(null);
    }
  }

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    return !q || [u.displayName, u.email].some((v) => v.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Tim Audit AR</h1>
        <p className="text-sm text-muted-foreground">
          Tetapkan akses Supervisor atau Field Audit untuk pengguna.
        </p>
      </div>

      <div className="relative sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Cari nama atau email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title="Tidak ada pengguna" />
      ) : (
        <div className="rounded-lg border border-border/50 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-48">Akses Audit AR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.uid}>
                  <TableCell className="font-medium">{u.displayName || "-"}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <Select
                      value={u.auditRole ?? ROLE_VALUE.none}
                      onValueChange={(v) => changeRole(u, v ?? ROLE_VALUE.none)}
                      disabled={savingUid === u.uid}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ROLE_VALUE.none}>Tidak ada</SelectItem>
                        <SelectItem value={ROLE_VALUE.supervisor}>Supervisor</SelectItem>
                        <SelectItem value={ROLE_VALUE.fieldAudit}>Field Audit</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
