"use client";

import { Factory, Hospital, Store, Utensils } from "lucide-react";
import { useTranslations } from "next-intl";

/** Shared auth pages describe supported industries without implying certification. */
export function AuthComplianceBadges({ className = "" }: { className?: string }) {
  const t = useTranslations("auth.badges");
  const industries = [
    { label: t("medical"), icon: Hospital },
    { label: t("catering"), icon: Utensils },
    { label: t("production"), icon: Factory },
    { label: t("retail"), icon: Store },
  ];

  return (
    <section className={"border-t border-white/10 pt-6 " + className} data-auth-badges>
      <h2 className="text-[14px] font-medium text-white/90">{t("title")}</h2>
      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] text-white/80" aria-label={t("title")}>
        {industries.map(({ label, icon: Icon }) => (
          <li key={label} className="flex items-center gap-2">
            <Icon aria-hidden="true" className="size-4 shrink-0 text-[#7cf5c0]" />
            {label}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[12.5px] leading-relaxed text-white/65">{t("forms")}</p>
    </section>
  );
}
