"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { useSectionPlace } from "@/components/layout/section-tabs";

/**
 * Шапка страницы раздела (эскизы руководителя 2026-10-17: «сверху заголовок
 * страницы»): один видимый заголовок — по умолчанию название пункта меню
 * раздела, — под ним одна строка пояснения, справа действия. Разметка та же,
 * что у `PageHeader`, чтобы страницы разделов выглядели одинаково.
 *
 * Надстрочной подписи раздела нет (руководитель 2026-10-18: «дубль
 * заголовков»): раздел уже назван в меню слева, на телефоне — в листе меню, в
 * Mini App — на полосе меню раздела.
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
  /** Свой заголовок; нет — название вкладки пункта, пункта меню, затем раздела. */
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const { section, menuItem, menuTab } = useSectionPlace();
  const heading = title ?? menuTab?.label ?? menuItem?.label ?? section?.label ?? null;
  return <PageHeader title={heading} description={description} actions={actions} className={className} />;
}
