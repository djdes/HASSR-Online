"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { useInItemDialog } from "../item-dialog";

/**
 * Тихая ссылка «Изменить в …» / «Открыть …» на источник данных. Внутри окна
 * пункта ссылка на другой пункт заменяет адрес окна, а не добавляет шаг
 * истории: крестик (`router.back()`) возвращает на обзор, а не в прошлый
 * пункт. На отдельной странице пункта — обычный переход: иначе закрытие
 * открытого поверх окна увело бы со страницы.
 */
export function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  const inDialog = useInItemDialog();
  const toItem = href.startsWith("/production-control/item/");
  return (
    <Link
      href={href}
      replace={inDialog && toItem}
      scroll={toItem ? false : undefined}
      className="inline-flex items-center gap-1 rounded-lg text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
    >
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden />
    </Link>
  );
}
