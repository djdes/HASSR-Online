"use client";

import { useState } from "react";
import { useSubmitLock } from "@/lib/use-submit-lock";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ProductData {
  id: string;
  name: string;
  supplier: string | null;
  barcode: string | null;
  unit: string;
  category: string | null;
  storageTemp: string | null;
  shelfLifeDays: number | null;
}

interface ProductDialogProps {
  product?: ProductData;
}

export function ProductDialog({ product }: ProductDialogProps) {
  const router = useRouter();
  const isEdit = !!product;
  const [open, setOpen] = useState(false);
  // Двойной тап по кнопке успевал отправить два одинаковых запроса:
  // setState применяется только к следующему рендеру. Замок синхронный.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(product?.name ?? "");
  const [supplier, setSupplier] = useState(product?.supplier ?? "");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [unit, setUnit] = useState(product?.unit ?? "kg");
  const [category, setCategory] = useState(product?.category ?? "");
  const [storageTemp, setStorageTemp] = useState(product?.storageTemp ?? "");
  const [shelfLifeDays, setShelfLifeDays] = useState(product?.shelfLifeDays?.toString() ?? "");

  function resetForm() {
    setName(product?.name ?? "");
    setSupplier(product?.supplier ?? "");
    setBarcode(product?.barcode ?? "");
    setUnit(product?.unit ?? "kg");
    setCategory(product?.category ?? "");
    setStorageTemp(product?.storageTemp ?? "");
    setShelfLifeDays(product?.shelfLifeDays?.toString() ?? "");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!acquire()) return;
    setError(null);

    try {
      const body = {
        ...(isEdit && { id: product.id }),
        name,
        supplier: supplier || null,
        barcode: barcode || null,
        unit,
        category: category || null,
        storageTemp: storageTemp || null,
        shelfLifeDays: shelfLifeDays ? Number(shelfLifeDays) : null,
      };

      const response = await fetch("/api/products", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
          <Button variant="outline"><Plus className="size-4" />Добавить продукт</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Редактировать продукт" : "Добавить продукт"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}
          <div className="space-y-2">
            <Label htmlFor="prod-name">Наименование <span className="text-destructive">*</span></Label>
            <Input id="prod-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Молоко 3.2%" required />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="space-y-2">
              <Label htmlFor="prod-supplier">Поставщик</Label>
              <Input id="prod-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="ООО «Поставщик»" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-barcode">Штрих-код</Label>
              <Input id="prod-barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="4600000000000" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <div className="space-y-2">
              <Label htmlFor="prod-unit">Единица</Label>
              <Input id="prod-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-category">Категория</Label>
              <Input id="prod-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Молочная" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-shelf">Срок (дни)</Label>
              <Input id="prod-shelf" type="number" value={shelfLifeDays} onChange={(e) => setShelfLifeDays(e.target.value)} placeholder="30" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="prod-temp">Температура хранения</Label>
            <Input id="prod-temp" value={storageTemp} onChange={(e) => setStorageTemp(e.target.value)} placeholder="+2...+6°C" />
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
