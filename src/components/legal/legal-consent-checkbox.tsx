"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Обязательная галка согласия с документами (2026-09-22). Не отмечена по
 * умолчанию; без неё регистрация не отправляется (сервер тоже проверяет).
 */
export function LegalConsentCheckbox({
  checked,
  onChange,
  tone = "light",
  className,
  highlight,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  tone?: "light" | "dark";
  className?: string;
  /** Пытались отправить без галки — подсветить. */
  highlight?: boolean;
}) {
  const t = useTranslations("auth.legal");
  const descriptionId = useId();
  const dark = tone === "dark";
  const link = cn(
    "underline underline-offset-2 transition-colors",
    dark ? "text-white/90 hover:text-white" : "text-[#3848c7] hover:text-[#0b1024]"
  );
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-2xl px-1 py-1 text-left text-[12.5px] leading-[1.5] transition-colors",
        dark ? "text-white/70" : "text-[#6f7282]",
        highlight && !checked && (dark ? "bg-white/10 ring-2 ring-[#ffb4ab]/60" : "bg-[#fff4f2] ring-2 ring-[#f2b8b0]"),
        className
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-[18px] shrink-0 accent-[#5566f6]"
        data-testid="legal-consent"
        aria-describedby={descriptionId}
      />
      <span id={descriptionId}>
        {t.rich("consentSentence", {
          offer: (chunks) => <Link href="/oferta" target="_blank" className={link}>{chunks}</Link>,
          terms: (chunks) => <Link href="/terms" target="_blank" className={link}>{chunks}</Link>,
          privacy: (chunks) => <Link href="/privacy" target="_blank" className={link}>{chunks}</Link>,
          consent: (chunks) => <Link href="/consent" target="_blank" className={link}>{chunks}</Link>,
        })}
      </span>
    </label>
  );
}
