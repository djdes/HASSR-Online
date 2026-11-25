"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Globe2 } from "lucide-react";
import { toast } from "sonner";
import { offeredLocales, LOCALE_NAMES, type Locale } from "@/i18n/locales";

/**
 * Язык интерфейса человека. `compact` — низ меню профиля (слева от «Выйти»):
 * без рамки, значок глобуса и название языка. `variant="mini"` — строка
 * карточки профиля мини-приложения: заголовок слева, список справа
 * (`.mini-row` и `.mini-select` в mini-theme.css, цвета темы приложения).
 */
export function PersonalLanguageSelect({
  compact = false,
  variant = "site",
}: { compact?: boolean; variant?: "site" | "mini" } = {}) {
  const selectId = useId();
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

  const options = offeredLocales(locale).map((value) => (
    <option key={value} value={value} lang={value}>{LOCALE_NAMES[value]}</option>
  ));

  if (variant === "mini") {
    return (
      <div className="mini-row" data-testid="personal-language">
        <label htmlFor={selectId} className="mini-card-title">
          {t("label")}
        </label>
        <span className="mini-select-wrap">
          <select
            id={selectId}
            name="locale"
            value={locale}
            disabled={saving || refreshing}
            aria-busy={saving || refreshing}
            onChange={(event) => void changeLanguage(event.target.value as Locale)}
            className="mini-select"
          >
            {options}
          </select>
        </span>
      </div>
    );
  }

  return (
    <label
      title={t("label")}
      className={
        compact
          ? "inline-flex h-9 min-w-0 shrink items-center gap-1.5 rounded-lg px-2 text-[13.5px] text-[#3c4053] transition-colors duration-150 hover:bg-[var(--app-tint-indigo)]"
          : "inline-flex min-h-11 shrink-0 items-center gap-1 rounded-2xl border border-[#ececf4] px-2 text-[13px] text-[#3848c7]"
      }
      data-testid="personal-language"
    >
      <Globe2 className={compact ? "size-4 shrink-0 text-[#6f7282]" : "size-4"} aria-hidden="true" />
      <span className="sr-only">{t("label")}</span>
      <select
        value={locale}
        disabled={saving || refreshing}
        onChange={(event) => void changeLanguage(event.target.value as Locale)}
        className={
          compact
            ? "h-9 min-w-0 max-w-32 cursor-pointer bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]"
            : "min-h-11 max-w-28 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]"
        }
      >
        {options}
      </select>
    </label>
  );
}
