"use client";

import { useState } from "react";
import { useSubmitLock } from "@/lib/use-submit-lock";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface AreaDialogProps {
  area?: { id: string; name: string; description: string | null };
}

export function AreaDialog({ area }: AreaDialogProps) {
  const router = useRouter();
  const isEdit = !!area;
  const [open, setOpen] = useState(false);
  // Двойной тап по кнопке успевал отправить два одинаковых запроса:
  // setState применяется только к следующему рендеру. Замок синхронный.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(area?.name ?? "");
  const [description, setDescription] = useState(area?.description ?? "");

  function resetForm() {
    setName(area?.name ?? "");
    setDescription(area?.description ?? "");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!acquire()) return;
    setError(null);

    try {
      const url = isEdit ? `/api/areas/${area.id}` : "/api/areas";
      const response = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || undefined }),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Ошибка");
      }

      if (!isEdit) resetForm();
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      release();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button variant="ghost" size="sm"><Pencil className="size-4" /></Button>
        ) : (
          <Button><Plus className="size-4" />Добавить цех</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Редактировать цех" : "Добавить цех"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}
          <div className="space-y-2">
            <Label htmlFor="area-name">Название <span className="text-destructive">*</span></Label>
            <Input id="area-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Цех №1" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="area-description">Описание</Label>
            <Textarea id="area-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Описание цеха или участка" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>Отмена</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Сохранение..." : isEdit ? "Сохранить" : "Создать"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
