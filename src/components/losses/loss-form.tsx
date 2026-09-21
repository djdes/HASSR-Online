"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSubmitLock } from "@/lib/use-submit-lock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Props {
  areas: { id: string; name: string }[];
}

export function LossForm({ areas }: Props) {
  const router = useRouter();
  // Двойной тап отправлял два POST подряд: setState применяется только
  // к следующему рендеру. Синхронный замок отсекает второй вход.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState("");
  const [category, setCategory] = useState("writeoff");
  const [unit, setUnit] = useState("kg");
  const [areaId, setAreaId] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!acquire()) return;
    setError("");
    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/losses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          productName: form.get("productName"),
          quantity: form.get("quantity"),
          unit,
          costRub: form.get("costRub") || null,
          cause: form.get("cause") || null,
          areaId: areaId || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Не удалось сохранить. Попробуйте ещё раз.");
      }
      router.push("/losses");
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
        <Label>Категория потери *</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="overweight">Перевес</SelectItem>
            <SelectItem value="underweight">Недовес</SelectItem>
            <SelectItem value="packaging_defect">Брак упаковки</SelectItem>
            <SelectItem value="rework">Переработка</SelectItem>
            <SelectItem value="writeoff">Списание</SelectItem>
            <SelectItem value="bottleneck_idle">Простой узкого места</SelectItem>
            <SelectItem value="raw_material_variance">Разброс сырья</SelectItem>
            <SelectItem value="other">Другое</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="productName">Продукт *</Label>
        <Input id="productName" name="productName" required />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <div className="space-y-2">
          <Label htmlFor="quantity">Количество *</Label>
          <Input id="quantity" name="quantity" type="number" step="0.01" required />
        </div>
        <div className="space-y-2">
          <Label>Единица</Label>
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="kg">кг</SelectItem>
              <SelectItem value="l">л</SelectItem>
              <SelectItem value="pcs">шт</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="costRub">Стоимость (руб)</Label>
          <Input id="costRub" name="costRub" type="number" step="0.01" />
        </div>
      </div>

      {areas.length > 0 && (
        <div className="space-y-2">
          <Label>Участок</Label>
          <Select value={areaId} onValueChange={setAreaId}>
            <SelectTrigger><SelectValue placeholder="Выберите..." /></SelectTrigger>
            <SelectContent>
              {areas.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="cause">Причина</Label>
        <Textarea id="cause" name="cause" placeholder="Опишите причину потери" />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Сохранение..." : "Сохранить"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/losses")}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
