"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PLAN_SHIFTS, PLAN_PRIORITIES, planErrorKey, readPlanFormData, type PlanItem } from "./plan-presentation";
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


export function PlanForm() {
  const t = useTranslations("productionPlans");
  const router = useRouter();
  // Двойной тап отправлял два POST подряд: setState применяется только
  // к следующему рендеру. Синхронный замок отсекает второй вход.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState<ReturnType<typeof planErrorKey> | null>(null);
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
    setError(null);
    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readPlanFormData(form, shift, items)),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(planErrorKey(data?.error, res.status));
        return;
      }
      router.push("/plans");
    } catch {
      setError("saveFailed");
    } finally {
      release();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
      {error && <p role="alert" className="text-sm text-destructive">{t(`errors.${error}`)}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <div className="space-y-2">
          <Label htmlFor="date">{t("form.date")}</Label>
          <Input id="date" name="date" type="date" required defaultValue={localDayKey()} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="plan-shift">{t("form.shift")}</Label>
          <Select value={shift} onValueChange={setShift}>
            <SelectTrigger id="plan-shift"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PLAN_SHIFTS.map(value => <SelectItem key={value} value={value}>{t(`shiftOptions.${value}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("form.items")}</Label>
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="flex-1">
                <Input
                  placeholder={t("form.product")}
                  aria-label={t("form.productLabel", { index: i + 1 })}
                  value={item.sku}
                  onChange={(e) => updateItem(i, "sku", e.target.value)}
                />
              </div>
              <div className="w-24">
                <Input
                  type="number"
                  placeholder={t("form.quantity")}
                  aria-label={t("form.quantityLabel", { index: i + 1 })}
                  value={item.targetQuantity || ""}
                  onChange={(e) => updateItem(i, "targetQuantity", Number(e.target.value))}
                />
              </div>
              {/* «P1 / P2 / P3» человеку ничего не говорили — пишем
                  словами. Значения в базе прежние. */}
              <div className="w-[150px]">
                <Select value={item.priority} onValueChange={(v) => updateItem(i, "priority", v)}>
                  <SelectTrigger aria-label={t("form.priorityLabel", { index: i + 1 })}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PLAN_PRIORITIES.map(value => <SelectItem key={value} value={value}>{t(`priorities.${value}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={t("form.removeItem", { index: i + 1 })} onClick={() => removeItem(i)} disabled={items.length === 1}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addItem}>
          <Plus className="size-4" />
          {t("form.addItem")}
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">{t("form.notes")}</Label>
        <Textarea id="notes" name="notes" />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("form.creating") : t("form.create")}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/plans")}>
          {t("form.cancel")}
        </Button>
      </div>
    </form>
  );
}
