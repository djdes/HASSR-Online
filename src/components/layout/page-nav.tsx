"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import { getRouteTitle, getSiblingRoutes } from "@/lib/route-titles";
import { customSectionNameByHref } from "@/lib/custom-names";
import { useCustomNames } from "@/components/shared/custom-names-provider";

/**
 * Единая навигация страницы кабинета: «← Назад» + хлебные крошки.
 *
 * Рендерится один раз в `(dashboard)/layout.tsx` над `{children}` — вместо
 * сорока рукописных ссылок «← Настройки» с шестью разными подписями.
 *
 * Крошки собираются из `usePathname()` по словарю `ROUTE_TITLES`. Сегменты,
 * которых в словаре нет (динамические `[id]`, `[code]`), пропускаются: без
 * этого в пути светились бы сырые cuid'ы. Страница может уточнить хвост
 * цепочки, отрендерив `<PageCrumbs items={[…]} />` — серверный компонент
 * знает название документа, а `PageNav` про него знать не может.
 */

type CrumbOverride = { items: Crumb[] } | null;

const BreadcrumbContext = createContext<{
  override: CrumbOverride;
  setOverride: (value: CrumbOverride) => void;
}>({ override: null, setOverride: () => {} });

export function PageNavProvider({ children }: { children: React.ReactNode }) {
  const [override, setOverride] = useState<CrumbOverride>(null);
  const value = useMemo(() => ({ override, setOverride }), [override]);
  return (
    <BreadcrumbContext.Provider value={value}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

/**
 * Уточнение крошек для страниц с динамическим сегментом. Ничего не рисует —
 * только кладёт хвост цепочки в контекст и снимает его при уходе.
 *
 * Сериализуем items в ключ эффекта: массив-литерал из серверного компонента
 * каждый рендер новый, и зависимость по ссылке зациклила бы setState.
 */
export function PageCrumbs({ items }: { items: Crumb[] }) {
  const { setOverride } = useContext(BreadcrumbContext);
  const key = JSON.stringify(items);
  useEffect(() => {
    setOverride({ items: JSON.parse(key) as Crumb[] });
    return () => setOverride(null);
  }, [key, setOverride]);
  return null;
}

/**
 * Кнопка «← Назад» — ровно кнопка «назад» браузера, а не ссылка вверх по
 * иерархии. Человек пришёл сюда откуда-то конкретно (из списка, из поиска,
 * из уведомления) и ждёт, что вернётся туда же.
 *
 * `fallbackHref` нужен для прямого захода по ссылке: в новой вкладке
 * истории нет, и `router.back()` увёл бы с сайта.
 *
 * Отдельный экспорт, потому что раздел журналов рисует крошки серверно
 * (на своих страницах), а кнопка нужна и там — см. `journals/[code]/layout`.
 */
export function PageBackLink({
  fallbackHref = "/dashboard",
  className = "",
}: {
  fallbackHref?: string;
  className?: string;
}) {
  const router = useRouter();

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }

  return (
    <button
      type="button"
      onClick={goBack}
      title="Назад"
      aria-label="Назад"
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-[#ececf4] bg-white text-[#6f7282] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#5566f6] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 print:hidden ${className}`}
    >
      <ArrowLeft className="size-4" />
    </button>
  );
}

/**
 * Статические подпапки `/journals/*`, которые НЕ проходят через
 * `journals/[code]/layout.tsx` (в Next.js статический сегмент выигрывает у
 * динамического). Им нужна обычная глобальная навигация.
 */
const JOURNALS_STATIC_CHILDREN = new Set(["traceability"]);

/**
 * Подтверждает, что путь лежит в поддереве `journals/[code]`. Там своя
 * навигация: белая подложка раздела full-bleed, и крошки должны стоять
 * ВНУТРИ неё, а не над ней на сером фоне.
 */
function isJournalCodeSubtree(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "journals" || parts.length < 2) return false;
  return !JOURNALS_STATIC_CHILDREN.has(parts[1]);
}

export function PageNav({ organizationName }: { organizationName: string }) {
  const pathname = usePathname() || "/";
  const { override } = useContext(BreadcrumbContext);
  // Свои названия разделов организации — и в звене, и в списке соседей.
  const customNames = useCustomNames();

  // Каждое звено раскрывается в соседей по уровню: из «Здания и
  // помещения» — сразу в «Оборудование», не возвращаясь в список
  // настроек. Данных для этого не нужно — весь словарь маршрутов уже
  // на клиенте.
  const autoCrumbs = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    const result: Crumb[] = [];
    let prefix = "";
    parts.forEach((segment, index) => {
      prefix += `/${segment}`;
      const title = customSectionNameByHref(customNames, prefix) ?? getRouteTitle(prefix);
      if (!title) return;
      const isLast = index === parts.length - 1;
      const here = prefix;
      const siblings = getSiblingRoutes(here).map((sibling) => ({
        ...sibling,
        title: customSectionNameByHref(customNames, sibling.path) ?? sibling.title,
      }));
      result.push({
        label: title,
        href: isLast ? undefined : here,
        menu:
          siblings.length > 0
            ? [
                { label: title, href: here, current: true },
                ...siblings.map((s) => ({ label: s.title, href: s.path })),
              ]
            : undefined,
        menuTitle: siblings.length > 0 ? "Соседние разделы" : undefined,
      });
    });
    return result;
  }, [pathname, customNames]);

  const crumbs: Crumb[] = [
    { label: organizationName, href: "/dashboard" },
    ...(override?.items ?? autoCrumbs),
  ];

  // Родитель — последняя крошка со ссылкой; это запасной адрес для прямого
  // захода, когда истории в табе ещё нет.
  const parentHref =
    [...crumbs].reverse().find((crumb) => crumb.href)?.href ?? "/dashboard";

  // Скрыт только на самой «Главной»: она и есть корень, возвращаться с
  // неё некуда, а цепочка из одного звена ничего не объясняет. Везде
  // остальное — включая `/settings` — навигация есть всегда.
  if (pathname === "/dashboard" || isJournalCodeSubtree(pathname)) return null;

  // Кнопка и крошки — одной строкой. Раньше они стояли друг под другом в
  // 6px и одинаковым серым: читались как две строки одного текста, а не
  // как «кнопка» и «где я». Круглая кнопка слева задаёт строке начало.
  // На телефоне строка выше (кнопки 48px — app-theme.css), поэтому отступ
  // под ней 12px, а не 20: иначе выигрыш от тонкой шапки съедался.
  return (
    <div className="mb-5 flex min-w-0 items-center gap-3 print:hidden max-sm:mb-3">
      <PageBackLink fallbackHref={parentHref} />
      <Breadcrumbs items={crumbs} className="min-w-0 flex-1" />
    </div>
  );
}
