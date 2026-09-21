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

export function ChangeForm() {
  const router = useRouter();
  // Двойной тап отправлял два POST подряд: setState применяется только
  // к следующему рендеру. Синхронный замок отсекает второй вход.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState("");
  const [changeType, setChangeType] = useState("recipe");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!acquire()) return;
    setError("");
    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          changeType,
          description: form.get("description") || null,
          riskAssessment: form.get("riskAssessment") || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Не удалось сохранить. Попробуйте ещё раз.");
      }
      router.push("/changes");
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
        <Label htmlFor="title">Что изменяется *</Label>
        <Input id="title" name="title" required placeholder="Например: Замена поставщика муки" />
      </div>

      <div className="space-y-2">
        <Label>Тип изменения</Label>
        <Select value={changeType} onValueChange={setChangeType}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="recipe">Рецептура</SelectItem>
            <SelectItem value="process">Процесс</SelectItem>
            <SelectItem value="packaging">Упаковка</SelectItem>
            <SelectItem value="supplier">Поставщик</SelectItem>
            <SelectItem value="equipment">Оборудование</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Описание изменения</Label>
        <Textarea id="description" name="description" placeholder="Что именно меняется и почему" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="riskAssessment">Оценка рисков</Label>
        <Textarea id="riskAssessment" name="riskAssessment" placeholder="Возможные последствия: влияние на вкус, срок годности, аллергены..." />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Создание..." : "Создать заявку"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/changes")}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
