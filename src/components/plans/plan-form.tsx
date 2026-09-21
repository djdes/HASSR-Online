"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSubmitLock } from "@/lib/use-submit-lock";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
// Дата — по часам компьютера, а не по UTC: ночью в Москве поле «Дата»
// подставляло вчерашнее число.
import { localDayKey } from "@/lib/entry-defaults";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type PlanItem = { sku: string; targetQuantity: number; priority: string };

export function PlanForm() {
  const router = useRouter();
  // Двойной тап отправлял два POST подряд: setState применяется только
  // к следующему рендеру. Синхронный замок отсекает второй вход.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState("");
  const [shift, setShift] = useState("morning");
  const [items, setItems] = useState<PlanItem[]>([{ sku: "", targetQuantity: 0, priority: "P2" }]);

  function addItem() {
    setItems([...items, { sku: "", targetQuantity: 0, priority: "P2" }]);
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index));
  }

  function updateItem(index: number, field: keyof PlanItem, value: string | number) {
    const updated = [...items];
    (updated[index] as Record<string, unknown>)[field] = value;
    setItems(updated);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!acquire()) return;
    setError("");
    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: form.get("date"),
          shift,
          items: items.filter((i) => i.sku),
          notes: form.get("notes") || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Не удалось сохранить план. Попробуйте ещё раз.");
      }
      router.push("/plans");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      release();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <div className="space-y-2">
          <Label htmlFor="date">Дата *</Label>
          <Input id="date" name="date" type="date" required defaultValue={localDayKey()} />
        </div>
        <div className="space-y-2">
          <Label>Смена</Label>
          <Select value={shift} onValueChange={setShift}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="morning">Утренняя</SelectItem>
              <SelectItem value="evening">Вечерняя</SelectItem>
              <SelectItem value="night">Ночная</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Позиции плана</Label>
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex gap-2 items-end">
              <div className="flex-1">
                <Input
                  placeholder="Продукт"
                  value={item.sku}
                  onChange={(e) => updateItem(i, "sku", e.target.value)}
                />
              </div>
              <div className="w-24">
                <Input
                  type="number"
                  placeholder="Кол-во"
                  value={item.targetQuantity || ""}
                  onChange={(e) => updateItem(i, "targetQuantity", Number(e.target.value))}
                />
              </div>
              {/* «P1 / P2 / P3» человеку ничего не говорили — пишем
                  словами. Значения в базе прежние. */}
              <div className="w-[150px]">
                <Select value={item.priority} onValueChange={(v) => updateItem(i, "priority", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="P1">Высокий приоритет</SelectItem>
                    <SelectItem value="P2">Средний приоритет</SelectItem>
                    <SelectItem value="P3">Низкий приоритет</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(i)} disabled={items.length === 1}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addItem}>
          <Plus className="size-4" />
          Добавить позицию
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Примечания</Label>
        <Textarea id="notes" name="notes" />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Создание..." : "Создать план"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/plans")}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
