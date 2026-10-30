"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { isNavHrefDenied } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import { isJournalCodeSubtree } from "@/components/layout/page-nav";
import { useSectionPlace } from "@/components/layout/section-tabs";
import { useAppNav } from "@/components/layout/app-nav-context";
import { AccessDenied, AccessShellProvider } from "@/components/layout/access-denied";
import { useContentPending } from "@/components/layout/content-transition";
import { DeniedNotice } from "@/components/layout/denied-notice";
import { RouteSkeleton } from "@/components/layout/route-skeleton";

/**
 * Рамка каждой страницы кабинета (сайт и оболочка Mini App, П-3).
 *
 * • В разделе с меню (`section.menu`) на глубоких страницах пункта — ссылка
 *   «‹ {пункт}» на сам пункт. Где человек и что дальше, показывает меню
 *   раздела слева, поэтому оглавления, полос и «Назад/Дальше» здесь нет.
 *   Страницы журнала (`/journals/<код>/…`) рисуют свои крошки внутри белой
 *   подложки — там ссылки нет.
 * • Смена точки или организации (2026-10-29): пока новая страница не пришла,
 *   вместо неё — скелет по адресу; сама страница остаётся смонтированной
 *   (скрыта), состояние не теряется.
 * • Пункт меню, закрытый человеку по роли (`deniedHrefs` модели меню), —
 *   панель «Нет доступа» вместо страницы. Отказ сервера (`forbidden()`) и
 *   «Такой страницы нет» рисуются той же панелью внутри этой рамки.
 * • После редиректа proxy из закрытого раздела — одноразовая плашка.
 */
export function SectionFrame({
  children,
  shell = "site",
  homeHref,
}: {
  children: React.ReactNode;
  /** Сайт или оболочка Mini App: где подсказывать выбрать раздел. */
  shell?: "site" | "mini";
  /** Домашняя человека — кнопка «На главную» на панелях отказа. */
  homeHref: string;
}) {
  const t = useTranslations("navigation.shell");
  const { menuItem, depth } = useSectionPlace();
  const { deniedHrefs } = useAppNav();
  const pathname = usePathname() || "/";
  const pending = useContentPending();
  const denied = isNavHrefDenied(pathname, deniedHrefs);
  const showBack = Boolean(menuItem) && depth === "deep" && !isJournalCodeSubtree(pathname) && !denied;

  return (
    <AccessShellProvider value={{ shell, homeHref }}>
      <Suspense fallback={null}>
        <DeniedNotice />
      </Suspense>
      {showBack && menuItem ? (
        <Link
          href={menuItem.href}
          className={cn(
            "mb-3 inline-flex items-center gap-1 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] print:hidden",
            "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
          )}
        >
          <ChevronLeft className="size-4" />
          {menuItem.label}
        </Link>
      ) : null}
      {pending ? (
        <div data-content-pending>
          <RouteSkeleton pathname={pathname} label={t("contentLoading")} />
        </div>
      ) : null}
      {denied && !pending ? <AccessDenied kind="forbidden" /> : null}
      {/* Страница не размонтируется на время ожидания: `contents` не меняет
          раскладку, `hidden` прячет её под скелетом. Под панелью «Нет
          доступа» она тоже остаётся (скрытой): если сервер уводит со
          страницы редиректом, он сработает. */}
      <div className={pending || denied ? "hidden" : "contents"} aria-hidden={pending || denied || undefined}>
        {children}
      </div>
    </AccessShellProvider>
  );
}
