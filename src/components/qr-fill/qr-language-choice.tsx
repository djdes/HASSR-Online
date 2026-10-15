"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/i18n/locales";
import { SITE_LOCALE_COOKIE } from "@/i18n/site-locale";
import { useQrFillCopy } from "./qr-fill-presentation";

export function QrLanguageChoice() {
  const { scoped } = useQrFillCopy();
  return scoped ? <ScopedLanguageChoice /> : null;
}
function ScopedLanguageChoice() {
  const { locale, authenticated } = useQrFillCopy();
  const t = useTranslations("language");
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  async function change(value: Locale) {
    if (value === locale) return;
    setSaving(true); setFailed(false);
    try {
      if (authenticated) {
        const response = await fetch("/api/profile/locale", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: value }) });
        if (!response.ok) { setFailed(true); return; }
      } else {
        document.cookie = `${SITE_LOCALE_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
      }
      startTransition(() => router.refresh());
    } catch { setFailed(true); }
    finally { setSaving(false); }
  }
  return <div className="shrink-0 text-[12px]">
    <select aria-label={t("label")} value={locale} disabled={saving || refreshing} onChange={event => void change(event.target.value as Locale)} className="min-h-11 max-w-28 rounded-xl border border-white/30 bg-[#252b59] px-2 text-white">
      {LOCALES.map(value => <option key={value} value={value} lang={value}>{LOCALE_NAMES[value]}</option>)}
    </select>
    {failed ? <p role="alert" className="max-w-40 text-white">{t("saveFailed")}</p> : null}
  </div>;
}
