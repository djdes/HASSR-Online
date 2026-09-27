import { journalMatchesQuery } from "@/lib/journal-search";
import { sortJournalsByName } from "@/lib/journal-sort";

/**
 * Меню хлебных крошек без разметки: поиск по списку, легенда точек,
 * подсказка про пункты, которых в списке нет, и сборка переключателя
 * журналов. Разметка — в `components/ui/breadcrumbs.tsx`, здесь то,
 * что проверяется тестом.
 *
 * Только чистые функции и типы: модуль читают и серверные страницы
 * (сборка меню), и клиентская крошка (фильтр при вводе).
 */

/** Точка слева: `ok` — зелёная, `danger` — красная, `muted` — серая. */
export type CrumbStatus = "ok" | "danger" | "muted";

export type CrumbMenuItem = {
  label: string;
  href: string;
  /** Точка слева; что она значит, объясняет легенда крошки. */
  status?: CrumbStatus;
  /** Правая колонка пункта: период документа, причина. */
  hint?: string;
  /** Текущая страница — мягкая заливка вместо жирного шрифта. */
  current?: boolean;
  /**
   * Код журнала. Если задан — строка получает вложенное подменю с
   * документами этого журнала, подгружаемое при наведении.
   */
  submenuJournalCode?: string;
  /**
   * Что ещё находит пункт в поиске, кроме названия и подписи справа.
   * Журналу — его код: журнал ищут и по ссылке из переписки.
   */
  keywords?: string[];
};

export type CrumbLegendEntry = { status: CrumbStatus; label: string };

export type CrumbLink = {
  label: string;
  href: string;
  /** Серая подпись справа — что будет за ссылкой. */
  hint?: string;
};

/**
 * Пункты, убранные из списка (выключенные журналы). Если поиск совпал
 * с ними — под списком объясняем, почему их нет, вместо молчаливого
 * «ничего не нашлось».
 */
export type CrumbHiddenMatches = {
  labels: string[];
  /** Подпись перед названиями: [для одного, для нескольких]. */
  title: [string, string];
  /** Как вернуть пункт в список: ссылка — тому, кто это может. */
  link?: CrumbLink;
  /** Пояснение вместо ссылки — тем, кто вернуть не может. */
  note?: string;
};

/** Поиск, легенда и нижняя ссылка списка крошки. */
export type CrumbMenuOptions = {
  /** Поле поиска над списком; значение — подпись поля («Найти журнал»). */
  menuSearch?: string;
  /** Последняя строка списка: «Показать все». */
  menuFooterLink?: CrumbLink;
  /** Что означают точки. Показываем только те, что есть в списке. */
  menuLegend?: readonly CrumbLegendEntry[];
  menuHiddenMatches?: CrumbHiddenMatches;
};

/** Точки набора журналов. */
export const JOURNAL_STATUS_LEGEND: readonly CrumbLegendEntry[] = [
  { status: "ok", label: "заполнен сегодня" },
  { status: "danger", label: "ждёт заполнения" },
  { status: "muted", label: "выключен" },
];

/**
 * Точки документов журнала: открыт или закрыт. Своя легенда, потому что
 * у документа нет «выключен» и «заполнен сегодня» — раньше под списком
 * документов висела журнальная, и серая точка читалась как «выключен».
 */
export const DOCUMENT_STATUS_LEGEND: readonly CrumbLegendEntry[] = [
  { status: "ok", label: "открыт" },
  { status: "muted", label: "закрыт" },
];

/** Пункты, подходящие под запрос, в исходном порядке. */
export function filterCrumbMenu<T extends CrumbMenuItem>(
  items: readonly T[],
  query: string,
): T[] {
  return items.filter((item) =>
    journalMatchesQuery([item.label, item.hint, ...(item.keywords ?? [])], query),
  );
}

/** Строки легенды для статусов, которые реально есть в списке. */
export function legendEntriesFor(
  items: readonly CrumbMenuItem[],
  legend: readonly CrumbLegendEntry[],
): CrumbLegendEntry[] {
  const present = new Set(items.map((item) => item.status).filter(Boolean));
  return legend.filter((entry) => present.has(entry.status));
}

/** Скрытые пункты, подходящие под запрос. Пустой запрос — ни одного. */
export function matchingHidden(labels: readonly string[], query: string): string[] {
  if (!query.trim()) return [];
  return labels.filter((label) => journalMatchesQuery([label], query));
}

/** «А», «Б», «В» и ещё 2. */
export function quotedList(labels: readonly string[], max = 3): string {
  const shown = labels.slice(0, max).map((label) => `«${label}»`).join(", ");
  const rest = labels.length - max;
  return rest > 0 ? `${shown} и ещё ${rest}` : shown;
}

/**
 * Переключатель журналов в крошках: только включённые журналы
 * организации, «Показать все» ведёт в набор (он только у руководителя),
 * названия выключенных — для подсказки в поиске.
 */
export type JournalSwitcherMenu = {
  items: CrumbMenuItem[];
  /** «Показать все» → набор журналов; `null` — у сотрудника этой страницы нет. */
  showAllHref: string | null;
  /** Выключенные журналы (кроме текущего — он и так в списке). */
  disabledLabels: string[];
};

/** Страница «Набор журналов» — там включают выключенные. */
export const JOURNAL_SWITCHER_SHOW_ALL_HREF = "/settings/journals";

export function buildJournalSwitcherMenu(input: {
  /**
   * `name` — название для людей организации (своё или официальное),
   * `officialName` — официальное: по нему журнал тоже находится в поиске.
   */
  templates: ReadonlyArray<{ id: string; code: string; name: string; officialName?: string }>;
  disabledCodes: ReadonlySet<string>;
  filledTemplateIds: ReadonlySet<string>;
  currentCode?: string;
  showAllHref: string | null;
}): JournalSwitcherMenu {
  const { templates, disabledCodes, filledTemplateIds, currentCode } = input;
  const items: CrumbMenuItem[] = [];
  const disabledLabels: string[] = [];

  // По алфавиту — по названию, которое видит организация.
  for (const template of sortJournalsByName(templates, (t) => t.name)) {
    const disabled = disabledCodes.has(template.code);
    const current = template.code === currentCode;
    // Выключенный журнал в рабочий список не попадает — кроме текущего:
    // иначе из списка пропало бы «где я сейчас».
    if (disabled && !current) {
      disabledLabels.push(template.name);
      continue;
    }
    items.push({
      label: template.name,
      href: `/journals/${template.code}`,
      // Выключенный — серый, а не красный: его не «просрочили», его
      // просто не ведут, и красным он звал бы заполнять то, чего нет.
      status: disabled ? "muted" : filledTemplateIds.has(template.id) ? "ok" : "danger",
      hint: disabled ? "выключен" : undefined,
      current,
      // Наведение на строку раскрывает документы этого журнала —
      // второй уровень подгружается лениво, по одному запросу.
      submenuJournalCode: template.code,
      keywords:
        template.officialName && template.officialName !== template.name
          ? [template.code, template.officialName]
          : [template.code],
    });
  }

  return { items, showAllHref: input.showAllHref, disabledLabels };
}

/** Поиск, легенда и «Показать все» для обеих журнальных крошек. */
export function journalSwitcherOptions(menu: JournalSwitcherMenu): CrumbMenuOptions {
  const showAll = menu.showAllHref;
  return {
    menuSearch: "Найти журнал",
    menuFooterLink: showAll
      ? { label: "Показать все", href: showAll, hint: "включая выключенные" }
      : undefined,
    menuLegend: JOURNAL_STATUS_LEGEND,
    menuHiddenMatches:
      menu.disabledLabels.length > 0
        ? {
            labels: menu.disabledLabels,
            title: ["Выключен в наборе", "Выключены в наборе"],
            ...(showAll
              ? { link: { label: "Открыть набор журналов", href: showAll } }
              : { note: "Включить может руководитель" }),
          }
        : undefined,
  };
}
