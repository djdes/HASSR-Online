"use client";

import { LOCALES, LOCALE_NAMES, isLocale, type Locale } from "@/i18n/locales";
import { createElement, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { confirmAsync } from "@/components/ui/confirm-async";

/** Run the export during the confirm click so browser activation is retained. */
export function useExportLanguageChoice() {
  const locale = useLocale();
  const t = useTranslations("journalControls.documentActions");
  return useCallback((onConfirm: (locale: Locale) => void, confirmLabel?: string) => {
    let selectedLocale = locale;
    void confirmAsync({
      locale,
      title: t("exportTitle"),
      confirmLabel: confirmLabel ?? t("export"),
      children: createElement(ExportLanguageChoice, {
        locale, label: t("exportLanguage"), onChange: value => { selectedLocale = value; },
      }),
      onAccepted: () => onConfirm(selectedLocale),
    });
  }, [locale, t]);
}

/** Uncontrolled selection survives the confirmation portal's render cycle. */
export function ExportLanguageChoice({ locale, label, onChange }: {
  locale: Locale;
  label: string;
  onChange: (locale: Locale) => void;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      <select
        defaultValue={locale}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-foreground"
        onChange={(event) => { if (isLocale(event.target.value)) onChange(event.target.value); }}
      >
        {LOCALES.map((value) => <option key={value} value={value} lang={value}>{LOCALE_NAMES[value]}</option>)}
      </select>
    </label>
  );
}
