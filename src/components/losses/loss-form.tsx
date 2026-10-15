"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LOSS_CATEGORIES, lossErrorKey, readLossFormData } from "./loss-presentation";
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
  const t = useTranslations("productionLosses");
  const router = useRouter();
  // Двойной тап отправлял два POST подряд: setState применяется только
  // к следующему рендеру. Синхронный замок отсекает второй вход.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState<ReturnType<typeof lossErrorKey> | null>(null);
  const [category, setCategory] = useState("writeoff");
  const [unit, setUnit] = useState("kg");
  const [areaId, setAreaId] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!acquire()) return;
    setError(null);
    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/losses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readLossFormData(form, { category, unit, areaId })),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(lossErrorKey(data?.error, res.status));
        return;
      }
      router.push("/losses");
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
        <Label htmlFor="loss-category">{t("form.category")}</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger id="loss-category"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LOSS_CATEGORIES.map(value => <SelectItem key={value} value={value}>{value === "bottleneck_idle" ? t("form.bottleneckIdle") : t(`categories.${value}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="productName">{t("form.product")}</Label>
        <Input id="productName" name="productName" required />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <div className="space-y-2">
          <Label htmlFor="quantity">{t("form.quantity")}</Label>
          <Input id="quantity" name="quantity" type="number" step="0.01" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="loss-unit">{t("form.unit")}</Label>
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger id="loss-unit"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="kg">{t("units.kg")}</SelectItem>
              <SelectItem value="l">{t("units.l")}</SelectItem>
              <SelectItem value="pcs">{t("units.pcs")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="costRub">{t("form.cost")}</Label>
          <Input id="costRub" name="costRub" type="number" step="0.01" />
        </div>
      </div>

      {areas.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="loss-area">{t("form.area")}</Label>
          <Select value={areaId} onValueChange={setAreaId}>
            <SelectTrigger id="loss-area"><SelectValue placeholder={t("form.select")} /></SelectTrigger>
            <SelectContent>
              {areas.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="cause">{t("form.cause")}</Label>
        <Textarea id="cause" name="cause" placeholder={t("form.causePlaceholder")} />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("form.saving") : t("form.save")}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/losses")}>
          {t("form.cancel")}
        </Button>
      </div>
    </form>
  );
}
