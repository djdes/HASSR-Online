"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CHANGE_TYPES, changeErrorKey, readChangeFormData } from "./change-presentation";
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
  const t = useTranslations("changeManagement");
  const router = useRouter();
  // Двойной тап отправлял два POST подряд: setState применяется только
  // к следующему рендеру. Синхронный замок отсекает второй вход.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState<ReturnType<typeof changeErrorKey> | null>(null);
  const [changeType, setChangeType] = useState("recipe");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!acquire()) return;
    setError(null);
    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readChangeFormData(form, changeType)),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(changeErrorKey(data?.error, res.status));
        return;
      }
      router.push("/changes");
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
        <Label htmlFor="title">{t("form.title")}</Label>
        <Input id="title" name="title" required placeholder={t("form.titlePlaceholder")} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="change-type">{t("form.type")}</Label>
        <Select value={changeType} onValueChange={setChangeType}>
          <SelectTrigger id="change-type"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CHANGE_TYPES.map(value => <SelectItem key={value} value={value}>{t(`types.${value}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">{t("form.description")}</Label>
        <Textarea id="description" name="description" placeholder={t("form.descriptionPlaceholder")} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="riskAssessment">{t("form.riskAssessment")}</Label>
        <Textarea id="riskAssessment" name="riskAssessment" placeholder={t("form.riskPlaceholder")} />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t("form.creating") : t("form.create")}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/changes")}>
          {t("form.cancel")}
        </Button>
      </div>
    </form>
  );
}
