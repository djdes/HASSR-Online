"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSubmitLock } from "@/lib/use-submit-lock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function BatchForm() {
  const router = useRouter();
  // Двойной тап отправлял два POST подряд: setState применяется только
  // к следующему рендеру. Синхронный замок отсекает второй вход.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!acquire()) return;
    setError("");

    const form = new FormData(e.currentTarget);
    const body = {
      productName: form.get("productName"),
      supplier: form.get("supplier"),
      quantity: form.get("quantity"),
      unit: form.get("unit"),
      expiryDate: form.get("expiryDate") || null,
      notes: form.get("notes") || null,
    };

    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Ошибка");
      }
      const batch = await res.json();
      router.push(`/batches/${batch.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      release();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        <Label htmlFor="productName">Наименование продукта *</Label>
        <Input id="productName" name="productName" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="supplier">Поставщик</Label>
        <Input id="supplier" name="supplier" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <div className="space-y-2">
          <Label htmlFor="quantity">Количество *</Label>
          <Input id="quantity" name="quantity" type="number" step="0.01" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="unit">Единица</Label>
          <Select name="unit" defaultValue="kg">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="kg">кг</SelectItem>
              <SelectItem value="l">л</SelectItem>
              <SelectItem value="pcs">шт</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="expiryDate">Срок годности</Label>
        <Input id="expiryDate" name="expiryDate" type="date" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Примечания</Label>
        <Textarea id="notes" name="notes" />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Создание..." : "Создать партию"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/batches")}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
