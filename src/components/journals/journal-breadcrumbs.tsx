"use client";

import { Breadcrumbs, type Crumb } from "@/components/ui/breadcrumbs";
import { PageBackLink } from "@/components/layout/page-nav";
import { useCustomNames } from "@/components/shared/custom-names-provider";
import {
  journalSwitcherOptions,
  type JournalSwitcherMenu,
} from "@/lib/crumb-menu";
import { customJournalName, customSectionName } from "@/lib/custom-names";

/**
 * Хлебные крошки раздела журналов:
 * «<Организация> › Журналы › <Журнал> › <Документ>».
 *
 * Тонкая обёртка над общими `Breadcrumbs` — разметка одна на весь кабинет.
 *
 * Рендерится СЕРВЕРНО на уровне страниц `(dashboard)/journals/*`, а НЕ внутри
 * `*-document-client.tsx`. Причина: клиенты переиспользуются Mini App'ом
 * (`/mini/documents/[id]`), у которого своя навигация (MiniTopBar + MiniNav),
 * и вторая цепочка крошек там была бы лишней.
 *
 * Серверный рендер — ещё и причина, почему раздел не пользуется глобальным
 * `PageNav`: тот собирает крошки на клиенте, и на странице журнала имя
 * подставлялось бы вторым кадром, после вспышки «Журналы».
 *
 * Свои названия организации («Журналы» и название журнала) берутся из
 * `CustomNamesProvider`: его значение приходит с сервера вместе с
 * разметкой, поэтому своё название видно в первом же кадре.
 */

export type JournalCrumb = Crumb;

export function JournalBreadcrumbs({
  items,
  className = "",
}: {
  items: JournalCrumb[];
  className?: string;
}) {
  return <Breadcrumbs items={items} className={className} />;
}

/**
 * Готовая цепочка раздела: организация → «Журналы» → журнал → хвост.
 *
 * Собирается здесь, а не на каждой странице, чтобы порядок и ссылки звеньев
 * не разъезжались между списком документов, бланком, гайдом и проверкой.
 * `tail` — то, что знает только конкретная страница: название документа,
 * «Новая запись», «Проверка».
 */
export function JournalPageCrumbs({
  organizationName,
  journalName,
  journalCode,
  journalMenu,
  tail = [],
  className = "",
  backHref = "/journals",
}: {
  organizationName: string;
  journalName?: string;
  journalCode?: string;
  /**
   * Переключатель журналов (`getJournalCrumbMenu`): звенья «Журналы» и
   * «журнал» раскрываются в него — с поиском, легендой и «Показать все».
   */
  journalMenu?: JournalSwitcherMenu;
  tail?: JournalCrumb[];
  className?: string;
  /** Куда вернуться при прямом заходе: истории в новой вкладке нет. */
  backHref?: string;
}) {
  // Поиск «Найти журнал», легенда точек и «Показать все» — одинаковые у
  // обоих звеньев: в Mini App на телефоне видно только одно из них
  // (второе прячет mini-theme.css), и переключатель должен быть в любом.
  const switcher = journalMenu ? journalSwitcherOptions(journalMenu) : {};
  const customNames = useCustomNames();
  const journalLabel = journalName
    ? customJournalName(customNames, journalCode) ?? journalName
    : journalName;

  const items: JournalCrumb[] = [
    { label: organizationName, href: "/dashboard" },
    {
      label: customSectionName(customNames, "journals") ?? "Журналы",
      href: "/journals",
      // Двухуровневое, как «Проекты» в ProjectsFlow: журнал → его
      // документы. Отсюда можно попасть сразу в нужный бланк, не
      // открывая сперва журнал.
      menu: journalMenu?.items,
      menuTitle: journalMenu ? "Перейти к журналу" : undefined,
      ...switcher,
    },
  ];

  if (journalLabel) {
    // Ссылкой журнал становится, только когда он не последнее звено —
    // ссылка «сам на себя» на текущей странице сбивает с толку. Меню при
    // этом есть всегда: перейти в соседний журнал полезно и с него самого.
    //
    // Здесь список ПЛОСКИЙ: на этом уровне нужен быстрый переход
    // «журнал → журнал» по цвету точки, а вложенность только добавила бы
    // шаг к тому же самому.
    items.push({
      label: journalLabel,
      href: tail.length > 0 && journalCode ? `/journals/${journalCode}` : undefined,
      menu: journalMenu?.items.map(({ submenuJournalCode: _drop, ...rest }) => rest),
      menuTitle: journalMenu ? "Журналы набора" : undefined,
      ...switcher,
    });
  }

  items.push(...tail);

  // Кнопка «назад» стоит В ОДНОЙ строке с крошками, а не отдельной
  // строкой над ними: одинаковый серый текст в 6px друг над другом
  // читался как две строки одного текста. В остальном кабинете то же
  // самое делает `PageNav`; здесь крошки серверные, поэтому кнопку
  // подмешиваем тут, а не в layout'е раздела.
  return (
    <div className="flex min-w-0 items-center gap-3 print:hidden">
      <PageBackLink fallbackHref={backHref} />
      <Breadcrumbs items={items} className={`min-w-0 flex-1 ${className}`.trim()} />
    </div>
  );
}
