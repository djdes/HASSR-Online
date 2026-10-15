"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Globe2 } from "lucide-react";
import { toast } from "sonner";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/i18n/locales";

export function PersonalLanguageSelect() {
  const locale = useLocale();
  const t = useTranslations("language");
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [refreshing, startTransition] = useTransition();

  async function changeLanguage(value: Locale) {
    if (value === locale) return;
    setSaving(true);
    try {
      const response = await fetch("/api/profile/locale", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: value }),
      });
      if (!response.ok) throw new Error("locale-save-failed");
      // Refresh server-rendered text; individual form draft behavior is verified separately.
      startTransition(() => router.refresh());
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-2xl border border-[#ececf4] px-2 text-[13px] text-[#3848c7]">
      <Globe2 className="size-4" aria-hidden="true" />
      <span className="sr-only">{t("label")}</span>
      <select value={locale} disabled={saving || refreshing} onChange={(event) => void changeLanguage(event.target.value as Locale)} className="min-h-11 max-w-28 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]">
        {LOCALES.map((value) => <option key={value} value={value} lang={value}>{LOCALE_NAMES[value]}</option>)}
      </select>
    </label>
  );
}
