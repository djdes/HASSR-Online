"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useSectionPlace } from "@/components/layout/section-tabs";

/**
 * Шапка страницы раздела (эскизы руководителя 2026-10-17: «сверху заголовок
 * страницы»). Крупный видимый заголовок — по умолчанию название пункта меню
 * раздела, над ним тихая подпись раздела, под ним одна строка пояснения,
 * справа действия. В разделах с меню крошек нет, поэтому страница пункта без
 * своего заголовка ставит эту шапку.
 *
 * Клиентский: название пункта берёт из модели меню (`useSectionPlace`), а
 * страница может передать свой `title`.
 */
export function SectionPageHeader({
  title,
  description,
  actions,
  className,
}: {
  /** Свой заголовок; нет — название пункта меню, затем раздела. */
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const { section, menuItem, menuTab } = useSectionPlace();
  const heading = title ?? menuTab?.label ?? menuItem?.label ?? section?.label ?? null;
  // Подпись раздела — когда заголовок не повторяет его название.
  const eyebrow = section && heading !== section.label ? section.label : null;

  return (
    <header
      data-section-page-header
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 sm:min-w-[320px] sm:flex-1">
        {eyebrow ? (
          <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{eyebrow}</div>
        ) : null}
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024] [text-wrap:balance] md:text-[32px]">
          {heading}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-[720px] text-[14px] leading-[1.55] text-[#6f7282]">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:ml-auto sm:justify-end">{actions}</div>
      ) : null}
    </header>
  );
}
