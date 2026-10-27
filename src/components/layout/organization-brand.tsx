"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ImagePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { BRANDING_SETTINGS_HREF } from "@/components/theme/theme-tiles";

const FOCUS = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/** Первые буквы двух слов названия — монограмма вместо логотипа. */
function initialsOf(name: string): string {
  return (
    name
      .replace(/[«»"']/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toLocaleUpperCase("ru-RU") ?? "")
      .join("") || "W"
  );
}

function Monogram({ name, compact = false, large = false }: { name: string; compact?: boolean; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] font-semibold text-[#3848c7]",
        compact ? "size-8 text-[13px]" : large ? "size-14 rounded-2xl text-[20px]" : "size-9 text-[14px]",
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Логотип организации; нет логотипа — монограмма и название. */
export function OrganizationMark({
  logoUrl,
  name,
  compact = false,
  large = false,
}: {
  logoUrl: string | null;
  name: string;
  compact?: boolean;
  /** Шапка меню сайта (эскиз 2026-10-28: «лого крупнее в 2 раза») — до 80 px. */
  large?: boolean;
}) {
  // Битая ссылка на логотип не должна оставлять пустое место — монограмма.
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name}
        className={cn(
          "w-auto object-contain object-left",
          compact ? "h-7 max-w-[120px]" : large ? "max-h-20 max-w-[216px]" : "max-h-10 max-w-[200px]",
        )}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Monogram name={name} compact={compact} large={large} />
      {compact ? null : (
        <span className={cn("font-semibold text-[#0b1024]", large ? "line-clamp-2 text-[16px] leading-tight" : "truncate text-[15px]")}>
          {name}
        </span>
      )}
    </span>
  );
}

/**
 * Шапка меню (эскиз руководителя: «Лого компании пользователя» над меню):
 * логотип компании клиента, без логотипа — монограмма и название. Руководителю
 * без логотипа — ссылка «Добавить логотип» на блок брендинга «Моей компании».
 * Общая для сайдбара, листа меню на телефоне и листа меню в Mini App (П-3).
 */
export function OrganizationBrand({
  logoUrl,
  name,
  homeHref,
  canEditBranding = false,
  large = false,
  className,
}: {
  logoUrl: string | null;
  name: string;
  homeHref: string;
  canEditBranding?: boolean;
  /** Крупный логотип — шапка сайдбара. */
  large?: boolean;
  className?: string;
}) {
  const t = useTranslations("navigation.shell");
  if (logoUrl || !canEditBranding) {
    return (
      <Link
        href={homeHref}
        className={cn("flex min-w-0 items-center rounded-xl transition-colors duration-150", FOCUS, className)}
        data-organization-brand
      >
        <OrganizationMark key={logoUrl ?? "none"} logoUrl={logoUrl} name={name} large={large} />
      </Link>
    );
  }
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)} data-organization-brand>
      <Link href={homeHref} tabIndex={-1} aria-hidden className="shrink-0 rounded-xl">
        <Monogram name={name} large={large} />
      </Link>
      <div className="flex min-w-0 flex-col leading-tight">
        <Link
          href={homeHref}
          className={cn("truncate rounded-md text-[15px] font-semibold text-[#0b1024] transition-colors duration-150 hover:text-[#3848c7]", FOCUS)}
        >
          {name}
        </Link>
        <Link
          href={BRANDING_SETTINGS_HREF}
          data-add-logo
          className={cn(
            "mt-0.5 inline-flex w-fit items-center gap-1 rounded-md text-[12.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6]",
            FOCUS,
          )}
        >
          <ImagePlus className="size-3.5 shrink-0" aria-hidden />
          {t("addLogo")}
        </Link>
      </div>
    </div>
  );
}
