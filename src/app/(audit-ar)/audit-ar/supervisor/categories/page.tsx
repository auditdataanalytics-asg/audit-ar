"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getCategories,
  createCategory,
  updateCategory,
} from "@/lib/audit-ar/firestore";
import type { AuditCategoryDoc, AuditCategoryType } from "@/lib/audit-ar/types";

export default function CategoriesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">Kategori</h1>
        <p className="text-sm text-muted-foreground">
          Pilihan yang dipakai Field Audit saat mengisi form.
        </p>
      </div>

      <Tabs defaultValue="buildingCondition">
        <TabsList>
          <TabsTrigger value="buildingCondition">Kondisi Bangunan</TabsTrigger>
          <TabsTrigger value="buildingType">Tipe Bangunan</TabsTrigger>
        </TabsList>
        <TabsContent value="buildingCondition" className="mt-4">
          <CategorySection type="buildingCondition" />
        </TabsContent>
        <TabsContent value="buildingType" className="mt-4">
          <CategorySection type="buildingType" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CategorySection({ type }: { type: AuditCategoryType }) {
  const [items, setItems] = useState<AuditCategoryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AuditCategoryDoc | null>(null);
  const [editLabel, setEditLabel] = useState("");

  async function load() {
    setItems(await getCategories(type));
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  async function handleAdd() {
    const label = newLabel.trim();
    if (!label) return;
    setAdding(true);
    try {
      const order = items.length ? Math.max(...items.map((i) => i.order)) + 1 : 0;
      await createCategory(type, label, order);
      setNewLabel("");
      await load();
    } catch {
      toast.error("Gagal menambah kategori");
    } finally {
      setAdding(false);
    }
  }

  async function toggleActive(item: AuditCategoryDoc) {
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, isActive: !i.isActive } : i)),
    );
    try {
      await updateCategory(item.id, { isActive: !item.isActive });
    } catch {
      toast.error("Gagal memperbarui");
      load();
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const label = editLabel.trim();
    if (!label) return;
    try {
      await updateCategory(editing.id, { label });
      setEditing(null);
      await load();
    } catch {
      toast.error("Gagal menyimpan");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Tambah kategori baru..."
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <Button onClick={handleAdd} disabled={adding || !newLabel.trim()}>
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="Belum ada kategori" className="py-10" />
      ) : (
        <div className="divide-y rounded-lg border border-border/50">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 p-3">
              <span className={item.isActive ? "flex-1 text-sm" : "flex-1 text-sm text-muted-foreground line-through"}>
                {item.label}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setEditing(item);
                  setEditLabel(item.label);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Switch checked={item.isActive} onCheckedChange={() => toggleActive(item)} />
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah kategori</DialogTitle>
          </DialogHeader>
          <Input
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveEdit()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Batal
            </Button>
            <Button onClick={saveEdit}>Simpan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
