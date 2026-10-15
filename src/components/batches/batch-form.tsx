"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { batchErrorKey, readBatchFormData } from "./batch-presentation";
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
  const t = useTranslations("productionBatches");
  const router = useRouter();
  // Двойной тап отправлял два POST подряд: setState применяется только
  // к следующему рендеру. Синхронный замок отсекает второй вход.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState<ReturnType<typeof batchErrorKey> | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!acquire()) return;
    setError(null);

    const form = new FormData(e.currentTarget);
    const body = readBatchFormData(form);

    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(batchErrorKey(data?.error, res.status));
        return;
      }
      const batch = await res.json();
      router.push(`/batches/${batch.id}`);
    } catch {
      setError("saveFailed");
    } finally {
      release();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
      {error && <p role="alert" className="text-sm text-destructive">{t(`errors.${error}`)}</p>}

      <div className="space-y-2">
        <Label htmlFor="productName">{t("form.productName")}</Label>
        <Input id="productName" name="productName" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="supplier">{t("supplier")}</Label>
        <Input id="supplier" name="supplier" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <div className="space-y-2">
          <Label htmlFor="quantity">{t("form.quantity")}</Label>
          <Input id="quantity" name="quantity" type="number" step="0.01" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="unit">{t("form.unit")}</Label>
          <Select name="unit" defaultValue="kg">
            <SelectTrigger id="unit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="kg">{t("units.kg")}</SelectItem>
              <SelectItem value="l">{t("units.l")}</SelectItem>
              <SelectItem value="pcs">{t("units.pcs")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="expiryDate">{t("expiryDate")}</Label>
        <Input id="expiryDate" name="expiryDate" type="date" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">{t("notes")}</Label>
        <Textarea id="notes" name="notes" />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("form.creating") : t("form.create")}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/batches")}>
          {t("form.cancel")}
        </Button>
      </div>
    </form>
  );
}
