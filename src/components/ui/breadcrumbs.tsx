"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight, EyeOff, Loader2, Search, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BottomSheet, SHEET_ROW_CLASS } from "@/components/ui/bottom-sheet";
import {
  DOCUMENT_STATUS_LEGEND,
  filterCrumbMenu,
  legendEntriesFor,
  matchingHidden,
  quotedList,
  type CrumbHiddenMatches,
  type CrumbLegendEntry,
  type CrumbMenuItem,
  type CrumbMenuOptions,
  type CrumbStatus,
} from "@/lib/crumb-menu";
import { useFinePointer, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import {
  MENU_ITEM_ACTIVE_CLASS,
  MENU_ITEM_CLASS,
  MENU_LABEL_CLASS,
  MENU_PANEL_CLASS,
  MENU_PANEL_PADDING_CLASS,
} from "@/components/ui/menu-styles";

/**
 * Хлебные крошки кабинета: «<Организация> › Журналы › <Журнал> › <Документ>».
 *
 * Собраны по образцу ProjectsFlow (тот, в свою очередь, снят с Notion):
 * каждое звено — не подпись, а сегмент-пилюля, который раскрывается ПРИ
 * НАВЕДЕНИИ в список соседей того же уровня. Текущее звено помечено
 * плотной мягкой заливкой, а не жирным шрифтом: так видно, где стоишь,
 * даже боковым зрением.
 *
 * Зачем: типичная смена — обойти несколько журналов подряд. Раньше это
 * стоило двух возвратов в список на каждый переход. Теперь переход
 * «журнал → журнал» и «документ → документ» делается прямо из строки
 * навигации, ни на что не нажимая.
 *
 * Двухуровневое меню: наведение на журнал в списке раскрывает его
 * документы, и клик по документу ведёт сразу в нужный бланк — не нужно
 * сперва открывать журнал, а потом искать документ. Клик по самой строке
 * журнала (мышью) — быстрый переход в журнал, самый частый сценарий.
 *
 * Тач: наведения нет, поэтому тап по строке журнала отдаётся Radix и
 * раскрывает подменю (документ выбирается вторым тапом) — иначе вложенный
 * уровень был бы недостижим с телефона.
 *
 * Поиск (`menuSearch`, «Найти журнал»): журналов в наборе три-четыре
 * десятка, и искать глазами дольше, чем набрать «гиг». Поле стоит над
 * списком, фильтрует по мере ввода («ё» = «е», слова в любом порядке),
 * Enter ведёт в первое совпадение. Фокус в поле встаёт сам только при
 * мыши: на телефоне он поднял бы клавиатуру поверх половины списка.
 * Под списком — легенда точек (только тех, что есть в списке) и
 * «Показать все» (`menuFooterLink`).
 *
 * Укорачивание — двумя независимыми способами:
 *  1. По длине подписи: каждое звено обрезается по `max-w` многоточием.
 *     Названия документов пользователь придумывает сам («Гигиенический
 *     журнал бригады №2, сентябрь»), и одно такое звено иначе распирает
 *     строку на две.
 *  2. По количеству: если звеньев больше `MAX_VISIBLE`, середина
 *     сворачивается в «…», которое само раскрывается тем же меню, — путь
 *     остаётся проходимым целиком, а не просто сокращённым.
 */

export type { CrumbLegendEntry, CrumbMenuItem } from "@/lib/crumb-menu";

export type Crumb = CrumbMenuOptions & {
  label: string;
  href?: string;
  /** Соседи того же уровня — раскрываются по наведению на звено. */
  menu?: CrumbMenuItem[];
  /** Подпись над списком: «Журналы набора», «Документы журнала». */
  menuTitle?: string;
};

/** Больше — сворачиваем середину в «…». Первое + «…» + два последних. */
const MAX_VISIBLE = 5;

/** Телефон (< 640px): список звена — листом снизу, а не выпадающим меню. */
const PHONE_QUERY = "(max-width: 639px)";

const STATUS_DOT: Record<CrumbStatus, string> = {
  ok: "bg-[#116b2a]",
  danger: "bg-[#a13a32]",
  muted: "bg-[#c6c9d8]",
};

/**
 * Что означают точки слева от строк. Без подписи зелёная и красная
 * точки читались как «хорошо/плохо вообще», а не «заполнено сегодня».
 * Строки — из данных крошки: у журналов «заполнен / ждёт / выключен»,
 * у документов «открыт / закрыт», и только те, что есть в списке.
 */
function StatusDotLegend({ entries }: { entries: readonly CrumbLegendEntry[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-1.5 text-[12px] text-[#6f7282]">
      {entries.map((entry) => (
        <span key={entry.status} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[entry.status])}
          />
          {entry.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Вид сегмента. Наведение — тихая заливка; текущий — плотная пилюля,
 * чтобы текущая страница читалась, а не выглядела «чуть жирнее».
 */
function segmentClass(current?: boolean): string {
  return cn(
    "flex min-w-0 items-center gap-1.5 rounded-xl px-2 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]/30",
    current
      ? "bg-[#eef1ff] font-medium text-[#0b1024]"
      : "text-[#6f7282] hover:bg-[#f5f6ff] hover:text-[#0b1024]",
  );
}

/**
 * Пункт меню. Подсветка при наведении задана ещё и через `hover:`:
 * пока в поле поиска есть текст, наведение не переводит фокус на пункт
 * (иначе ввод уезжал бы из поля), а без фокуса Radix пункт не подсвечивает.
 */
const ITEM_CLASS = cn(MENU_ITEM_CLASS, "hover:bg-[#f5f6ff]");

/** Подсветка ТЕКУЩЕГО пункта — мягкая заливка, как в ProjectsFlow. */
const CURRENT_ITEM_CLASS = cn(MENU_ITEM_ACTIVE_CLASS, "hover:bg-[#eef1ff]");

const PANEL_LABEL_CLASS = MENU_LABEL_CLASS;

/** Подменю документов — общие константы дизайн-системы (`menu-styles.ts`). */
const SUBPANEL_CLASS = cn(
  "w-72",
  MENU_PANEL_CLASS,
  MENU_PANEL_PADDING_CLASS,
  "max-h-80 overflow-y-auto",
);

/** Точки документов в подменю журнала — для текста диктору. */
const DOCUMENT_STATUS_TEXT: ReadonlyMap<CrumbStatus, string> = new Map(
  DOCUMENT_STATUS_LEGEND.map((entry) => [entry.status, entry.label] as const),
);

/**
 * Раскрытие по наведению с задержкой на закрытие: между сегментом и
 * панелью есть зазор, и без задержки список схлопывался ровно тогда,
 * когда курсор до него доезжал. 140 мс — как в ProjectsFlow.
 */
function useHoverMenu() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const openNow = useCallback(() => {
    cancel();
    setOpen(true);
  }, [cancel]);

  const closeSoon = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => setOpen(false), 140);
  }, [cancel]);

  return { open, setOpen, openNow, closeSoon, cancelClose: cancel };
}

/**
 * Поиск по списку крошки: запрос, отфильтрованные пункты, скрытые
 * совпадения и строки легенды. Один на лист и на выпадающее меню, чтобы
 * телефон и компьютер находили одно и то же.
 */
function useCrumbMenuSearch(crumb: Crumb, menu: CrumbMenuItem[]) {
  const [query, setQuery] = useState("");
  const clear = useCallback(() => setQuery(""), []);
  const results = useMemo(() => filterCrumbMenu(menu, query), [menu, query]);
  const hidden = crumb.menuHiddenMatches;
  const hiddenMatches = useMemo(
    () => (hidden ? matchingHidden(hidden.labels, query) : []),
    [hidden, query],
  );
  const legendSource = crumb.menuLegend;
  const legend = useMemo(
    () => (legendSource ? legendEntriesFor(menu, legendSource) : []),
    [legendSource, menu],
  );
  // Точки скрыты от экранного диктора (aria-hidden), поэтому смысл точки
  // проговариваем текстом внутри строки.
  const statusText = useMemo(
    () => new Map(legend.map((entry) => [entry.status, entry.label] as const)),
    [legend],
  );
  return {
    query,
    setQuery,
    clear,
    filtering: query.trim() !== "",
    results,
    hiddenMatches,
    legend,
    statusText,
  };
}

/**
 * Esc в поле с текстом сначала очищает поиск и только вторым нажатием
 * закрывает список. Слушаем окно в фазе перехвата: и лист, и меню
 * ловят Esc на `document` тоже в перехвате — окно раньше.
 */
function useEscapeClearsQuery(
  active: boolean,
  inputRef: RefObject<HTMLInputElement | null>,
  clear: () => void,
) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.activeElement !== inputRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      clear();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, inputRef, clear]);
}

export function Breadcrumbs({
  items,
  className = "",
}: {
  items: Crumb[];
  className?: string;
}) {
  const visible = items.filter((item) => item.label.trim().length > 0);
  if (visible.length === 0) return null;

  const collapsed =
    visible.length > MAX_VISIBLE ? visible.slice(1, visible.length - 2) : [];
  const shown: Crumb[] =
    collapsed.length > 0
      ? [
          visible[0],
          {
            label: "…",
            menuTitle: "Пропущенные разделы",
            menu: collapsed.map((crumb) => ({
              label: crumb.label,
              href: crumb.href ?? "#",
            })),
          },
          ...visible.slice(visible.length - 2),
        ]
      : visible;

  const hideFirstOnPhone = shown.length >= 3;

  return (
    <nav
      aria-label="Хлебные крошки"
      className={cn(
        "flex min-w-0 flex-nowrap items-center gap-0.5 text-[13px] print:hidden",
        className,
      )}
    >
      {shown.map((item, index) => (
        <span
          key={`${item.label}-${index}`}
          className={cn(
            "flex min-w-0 items-center gap-0.5",
            // Телефон, путь из 3+ звеньев: название организации — самое
            // бесполезное звено (рядом кнопка «назад»), а места оно отнимало
            // столько, что остальные сжимались до «Ж.» и «Чек-ли…».
            hideFirstOnPhone && index === 0 && "max-sm:hidden",
          )}
        >
          {index > 0 ? (
            <ChevronRight
              aria-hidden
              className={cn(
                "size-4 shrink-0 text-[#c6c9d8]",
                hideFirstOnPhone && index === 1 && "max-sm:hidden",
              )}
            />
          ) : null}
          <CrumbNode crumb={item} isLast={index === shown.length - 1} />
        </span>
      ))}
    </nav>
  );
}

type CrumbMenuVariantProps = {
  crumb: Crumb;
  menu: CrumbMenuItem[];
  isLast: boolean;
  /** Общий переход крошки (см. `useTransition` в `CrumbNode`). */
  navigate: (href: string) => void;
  /** Подпись сегмента и крутилка перехода. */
  children: ReactNode;
};

function CrumbNode({ crumb, isLast }: { crumb: Crumb; isLast: boolean }) {
  const router = useRouter();
  // На телефоне список журналов и документов открывается листом снизу:
  // выпадающее меню давало мелкие строки у левого края, а вложенное
  // подменю документов туда не помещалось вовсе.
  //
  // `useMediaQuery`, а не `useIsNarrowViewport`: тот читает экран уже в
  // кадре гидрации, и на телефоне клиент рисовал кнопку листа поверх
  // серверной кнопки меню — React ругался на расхождение атрибутов и не
  // исправлял их. Здесь гидрация идёт серверным вариантом, лист
  // подменяется следующим кадром.
  const narrow = useMediaQuery(PHONE_QUERY);
  // Переход по крошке идёт через router.push, а не через <Link> — у
  // клика нет фиксированной вёрстки-ссылки (сегмент, пункт меню и строка
  // журнала ведут в разные места). useTransition даёт тот же отклик на
  // нажатие, что LinkPendingSpinner у настоящих <Link>: крутилка встаёт
  // рядом с названием этой крошки, пока переход не завершится.
  const [isPending, startTransition] = useTransition();
  const navigate = useCallback(
    (href: string) => {
      startTransition(() => {
        router.push(href);
      });
    },
    [router],
  );

  // Длинные названия обрезаем многоточием: одно имя документа иначе
  // растягивает всю строку навигации.
  const labelClass = isLast
    ? "max-w-[11rem] truncate sm:max-w-[20rem]"
    : "max-w-[8rem] truncate sm:max-w-[14rem]";
  const label = (
    <>
      <span className={labelClass}>{crumb.label}</span>
      {isPending ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-[#5566f6]" />
      ) : null}
    </>
  );

  if (!crumb.menu || crumb.menu.length === 0) {
    const Tag = crumb.href && !isLast ? "button" : "span";
    return (
      <Tag
        {...(Tag === "button"
          ? {
              type: "button" as const,
              onClick: () => navigate(crumb.href as string),
            }
          : { "aria-current": isLast ? ("page" as const) : undefined })}
        title={crumb.label}
        className={segmentClass(isLast)}
      >
        {label}
      </Tag>
    );
  }

  const Variant = narrow ? CrumbSheetMenu : CrumbDropdownMenu;
  return (
    <Variant crumb={crumb} menu={crumb.menu} isLast={isLast} navigate={navigate}>
      {label}
    </Variant>
  );
}

/**
 * Телефон: список листом снизу. Поле поиска прилипает к верху листа,
 * легенда и «Показать все» — в подвале, всегда на виду.
 */
function CrumbSheetMenu({ crumb, menu, isLast, navigate, children }: CrumbMenuVariantProps) {
  const [open, setOpen] = useState(false);
  const search = useCrumbMenuSearch(crumb, menu);
  const finePointer = useFinePointer();
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  const listId = useId();
  const searchLabel = crumb.menuSearch;
  const footerLink = crumb.menuFooterLink;

  useEscapeClearsQuery(open && search.query !== "", inputRef, search.clear);

  const openSheet = () => {
    // Каждое открытие — с чистого листа: прошлый запрос прятал бы
    // половину списка без видимой причины.
    search.clear();
    setLockedHeight(null);
    setOpen(true);
  };

  const pick = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  const changeQuery = (value: string) => {
    // Лист прижат к низу экрана: пока список сжимается под запрос, лист
    // становился ниже, и поле уезжало из-под пальца вниз. Высоту
    // запоминаем на первом символе и держим до закрытия.
    const body = bodyRef.current;
    const scroller = body?.parentElement;
    if (value && lockedHeight === null && body && scroller) {
      // Место на экране — от верха нашего блока до нижнего поля листа.
      // Верх меряем, а не вычисляем из отступов: липкая шапка поиска
      // уходит отрицательным полем вверх, и расчёт по padding ошибался
      // ровно на него.
      const bodyTop =
        body.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        scroller.clientTop +
        scroller.scrollTop;
      const room =
        scroller.clientHeight -
        bodyTop -
        parseFloat(window.getComputedStyle(scroller).paddingBottom);
      setLockedHeight(Math.min(body.offsetHeight, room));
    }
    search.setQuery(value);
  };

  const footer =
    search.legend.length > 0 || footerLink ? (
      <div>
        {search.legend.length > 0 ? <StatusDotLegend entries={search.legend} /> : null}
        {footerLink ? (
          <button
            type="button"
            onClick={() => pick(footerLink.href)}
            className={cn(SHEET_ROW_CLASS, "font-medium text-[#3848c7]")}
          >
            <span className="min-w-0 flex-1 truncate">{footerLink.label}</span>
            {footerLink.hint ? (
              <span className="shrink-0 text-[12px] font-normal text-[#9b9fb3]">
                {footerLink.hint}
              </span>
            ) : null}
            <ArrowRight aria-hidden className="size-4 shrink-0 text-[#5566f6]" />
          </button>
        ) : null}
      </div>
    ) : undefined;

  return (
    <>
      <button
        type="button"
        title={crumb.label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openSheet}
        className={segmentClass(isLast)}
      >
        {children}
      </button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={crumb.menuTitle ?? crumb.label}
        footer={footer}
      >
        <div
          ref={bodyRef}
          style={lockedHeight !== null ? { minHeight: lockedHeight } : undefined}
        >
          {searchLabel ? (
            <div className="sticky top-0 z-10 -mx-3 -mt-2 bg-white px-3 pb-2 pt-2">
              <CrumbSearchInput
                inputRef={inputRef}
                variant="sheet"
                label={searchLabel}
                value={search.query}
                onChange={changeQuery}
                onSubmit={() => {
                  const first = search.results[0];
                  if (first) pick(first.href);
                }}
                listId={listId}
                autoFocus={finePointer}
              />
            </div>
          ) : null}
          <div id={listId}>
            {search.results.map((item) => (
              <button
                key={item.href + item.label}
                type="button"
                onClick={() => pick(item.href)}
                aria-current={item.current ? "page" : undefined}
                className={cn(
                  SHEET_ROW_CLASS,
                  item.current && "bg-[#f5f6ff] text-[#3848c7]",
                )}
              >
                {item.status ? (
                  <span
                    aria-hidden
                    className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[item.status])}
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <StatusText item={item} statusText={search.statusText} />
                {item.hint ? (
                  <span className="shrink-0 text-[12px] text-[#9b9fb3]">{item.hint}</span>
                ) : null}
              </button>
            ))}
          </div>
          <SearchOutcome
            crumb={crumb}
            search={search}
            renderAction={(link) => (
              <button
                type="button"
                onClick={() => pick(link.href)}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]/30 touch:min-h-12"
              >
                {link.label}
                <ArrowRight aria-hidden className="size-3.5" />
              </button>
            )}
          />
        </div>
      </BottomSheet>
    </>
  );
}

/**
 * Компьютер: выпадающее меню по наведению. Шапка (подпись + поиск) и
 * подвал (легенда + «Показать все») стоят на месте, прокручивается
 * только список между ними.
 */
function CrumbDropdownMenu({ crumb, menu, isLast, navigate, children }: CrumbMenuVariantProps) {
  const hover = useHoverMenu();
  const search = useCrumbMenuSearch(crumb, menu);
  const finePointer = useFinePointer();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const searchLabel = crumb.menuSearch;
  const footerLink = crumb.menuFooterLink;
  const { filtering } = search;

  useEscapeClearsQuery(hover.open && search.query !== "", inputRef, search.clear);

  // Каждое открытие — с чистого поиска. Сбрасываем при ОТКРЫТИИ, а не
  // при закрытии: так список не «вырастает» обратно во время анимации
  // исчезновения панели.
  const openNow = () => {
    if (!hover.open) search.clear();
    hover.openNow();
  };
  const setOpen = (next: boolean) => {
    if (next && !hover.open) search.clear();
    hover.setOpen(next);
  };
  // С набранным запросом уход мыши панель не закрывает: человек читает
  // результаты, а не держит курсор над списком. Закрыть — Esc (второй),
  // клик мимо или выбор пункта.
  const closeSoon = () => {
    if (!filtering) hover.closeSoon();
  };

  const pick = (href: string) => {
    hover.setOpen(false);
    navigate(href);
  };

  const changeQuery = (value: string) => {
    // Начал печатать, пока курсор уходил с панели, — не закрываемся.
    hover.cancelClose();
    search.setQuery(value);
  };

  const firstItem = () =>
    listRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])') ??
    null;

  // Пока фильтруем, наведение не забирает фокус из поля: Radix переводит
  // фокус на пункт под курсором, и следующая буква ушла бы в меню.
  const holdFocus = filtering
    ? (event: ReactPointerEvent) => event.preventDefault()
    : undefined;

  const hasHeader = Boolean(crumb.menuTitle || searchLabel);
  const hasFooter = search.legend.length > 0 || Boolean(footerLink);

  return (
    <DropdownMenu open={hover.open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger
        title={crumb.label}
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        // Клик по самому сегменту — переход по ссылке (если она есть), а не
        // открытие списка: список и так раскрыт наведением. На тач-устройстве
        // ссылки у текущего звена нет, и клик отдаётся Radix.
        onClick={(e) => {
          if (!crumb.href || isLast) return;
          e.preventDefault();
          hover.setOpen(false);
          navigate(crumb.href);
        }}
        className={segmentClass(isLast)}
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        onMouseEnter={hover.openNow}
        onMouseLeave={closeSoon}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onKeyDown={(event) => {
          const input = inputRef.current;
          const target = event.target as HTMLElement;
          if (!input || target === input || !listRef.current?.contains(target)) return;
          if (event.key === "ArrowUp" && target === firstItem()) {
            event.preventDefault();
            input.focus();
            return;
          }
          // Буква, набранная на пункте списка, уходит в поле поиска, а не
          // в «прыжок по первой букве» меню: у списка одно поведение.
          const printable =
            event.key.length === 1 &&
            event.key !== " " &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey;
          if (printable) {
            event.preventDefault();
            changeQuery(search.query + event.key);
            input.focus();
          }
        }}
        className={cn(
          "flex max-h-[min(26rem,var(--radix-dropdown-menu-content-available-height))] flex-col overflow-hidden p-0",
          searchLabel ? "w-80" : "w-72",
        )}
      >
        {hasHeader ? (
          <div className="shrink-0 px-1.5 pt-1.5">
            {crumb.menuTitle ? (
              <div className={PANEL_LABEL_CLASS}>{crumb.menuTitle}</div>
            ) : null}
            {searchLabel ? (
              <div className="px-1.5 pb-0.5 pt-1">
                <CrumbSearchInput
                  inputRef={inputRef}
                  variant="menu"
                  label={searchLabel}
                  value={search.query}
                  onChange={changeQuery}
                  onSubmit={() => {
                    const first = search.results[0];
                    if (first) pick(first.href);
                  }}
                  onArrowDown={() => firstItem()?.focus()}
                  listId={listId}
                  autoFocus={finePointer}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <div
          ref={listRef}
          id={listId}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
        >
          {search.results.map((item) =>
            item.submenuJournalCode ? (
              <JournalRowWithDocuments
                key={item.href + item.label}
                item={item}
                journalCode={item.submenuJournalCode}
                onNavigate={() => hover.setOpen(false)}
                navigate={navigate}
                statusText={search.statusText}
                holdFocus={holdFocus}
              />
            ) : (
              <DropdownMenuItem
                key={item.href + item.label}
                onSelect={() => pick(item.href)}
                onPointerMove={holdFocus}
                onPointerLeave={holdFocus}
                className={cn(ITEM_CLASS, item.current && CURRENT_ITEM_CLASS)}
              >
                <MenuRow item={item} statusText={search.statusText} />
              </DropdownMenuItem>
            ),
          )}
          <SearchOutcome
            crumb={crumb}
            search={search}
            renderAction={(link) => (
              <button
                type="button"
                onClick={() => pick(link.href)}
                className="inline-flex items-center gap-1 rounded-md font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]/30"
              >
                {link.label}
                <ArrowRight aria-hidden className="size-3.5" />
              </button>
            )}
          />
        </div>
        {hasFooter ? (
          <div className="shrink-0 border-t border-[#ececf4] p-1.5">
            {search.legend.length > 0 ? <StatusDotLegend entries={search.legend} /> : null}
            {footerLink ? (
              <DropdownMenuItem
                onSelect={() => pick(footerLink.href)}
                onPointerMove={holdFocus}
                onPointerLeave={holdFocus}
                className={cn(ITEM_CLASS, "font-medium text-[#3848c7]")}
              >
                <span className="min-w-0 flex-1 truncate">{footerLink.label}</span>
                {footerLink.hint ? (
                  <span className="shrink-0 text-[11px] font-normal text-[#9b9fb3]">
                    {footerLink.hint}
                  </span>
                ) : null}
                <ArrowRight aria-hidden className="size-4 text-[#5566f6]" />
              </DropdownMenuItem>
            ) : null}
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Поле поиска над списком. `type="search"` и «Перейти» на клавиатуре
 * телефона; свой крестик вместо системного — он одинаковый везде.
 */
function CrumbSearchInput({
  inputRef,
  variant,
  label,
  value,
  onChange,
  onSubmit,
  onArrowDown,
  listId,
  autoFocus,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  variant: "menu" | "sheet";
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Enter — переход в первое совпадение. */
  onSubmit: () => void;
  /** ↓ — к первому пункту списка (в выпадающем меню). */
  onArrowDown?: () => void;
  listId: string;
  /** Фокус при появлении — только при мыши (см. `useFinePointer`). */
  autoFocus: boolean;
}) {
  // Фокус ставим раньше, чем меню/лист фокусирует само себя: их
  // FocusScope видит, что фокус уже внутри, и не перебивает его.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus, inputRef]);

  return (
    <div className="relative" data-vaul-no-drag>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]"
      />
      <input
        ref={inputRef}
        type="search"
        enterKeyHint="go"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit();
            return;
          }
          if (event.key === "ArrowDown" && onArrowDown) {
            event.preventDefault();
            onArrowDown();
            return;
          }
          // Буквы и пробел остаются в поле: меню ловит их своим «прыжком
          // по первой букве» и уводит фокус из поля.
          if (event.key.length === 1) event.stopPropagation();
        }}
        placeholder={label}
        aria-label={label}
        aria-controls={listId}
        className={cn(
          "w-full appearance-none border border-[#dcdfed] bg-white pl-9 pr-10 text-[#0b1024] placeholder:text-[#9b9fb3] transition-[border-color,box-shadow] duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 [&::-webkit-search-cancel-button]:appearance-none",
          variant === "sheet" ? "h-11 rounded-2xl text-[15px]" : "h-10 rounded-xl text-[14px]",
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label="Очистить поиск"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className="absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[#9b9fb3] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]/30"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Под списком: «ничего не нашлось», подсказка про выключенные пункты,
 * совпавшие с запросом, и объявление числа найденного для диктора.
 */
function SearchOutcome({
  crumb,
  search,
  renderAction,
}: {
  crumb: Crumb;
  search: ReturnType<typeof useCrumbMenuSearch>;
  renderAction: (link: { label: string; href: string }) => ReactNode;
}) {
  const hidden = crumb.menuHiddenMatches;
  const empty = search.filtering && search.results.length === 0;
  return (
    <>
      {empty ? (
        <div className="px-3 py-5 text-center">
          <div className="break-words text-[13.5px] font-medium text-[#0b1024]">
            Ничего не нашлось по «{search.query.trim()}»
          </div>
          <div className="mt-1 text-[12.5px] text-[#6f7282]">
            Попробуйте часть слова или другое название
          </div>
        </div>
      ) : null}
      {hidden && search.hiddenMatches.length > 0 ? (
        <HiddenMatchesHint
          hidden={hidden}
          matches={search.hiddenMatches}
          action={hidden.link ? renderAction(hidden.link) : null}
        />
      ) : null}
      {crumb.menuSearch ? (
        <div aria-live="polite" className="sr-only">
          {search.filtering ? `Найдено: ${search.results.length}` : ""}
        </div>
      ) : null}
    </>
  );
}

/** «Выключен в наборе: «Бракераж…»» + как вернуть (ссылка или пояснение). */
function HiddenMatchesHint({
  hidden,
  matches,
  action,
}: {
  hidden: CrumbHiddenMatches;
  matches: string[];
  action: ReactNode;
}) {
  return (
    <div className="mx-1 my-1.5 flex gap-2.5 rounded-xl border border-[#ececf4] bg-[#fafbff] px-3 py-2.5 text-[12.5px] leading-snug text-[#6f7282]">
      <EyeOff aria-hidden className="mt-px size-4 shrink-0 text-[#9b9fb3]" />
      <div className="min-w-0 space-y-1">
        <p className="break-words">
          <span className="font-medium text-[#3c4053]">
            {matches.length === 1 ? hidden.title[0] : hidden.title[1]}:
          </span>{" "}
          {quotedList(matches)}
        </p>
        {action ?? (hidden.note ? <p>{hidden.note}</p> : null)}
      </div>
    </div>
  );
}

/** Смысл точки строки — текстом для экранного диктора. */
function StatusText({
  item,
  statusText,
}: {
  item: CrumbMenuItem;
  statusText: ReadonlyMap<CrumbStatus, string>;
}) {
  const text = item.status ? statusText.get(item.status) : undefined;
  return text ? <span className="sr-only">, {text}</span> : null;
}

/** Одна строка списка: точка статуса, название, правая подпись. */
function MenuRow({
  item,
  statusText,
}: {
  item: CrumbMenuItem;
  statusText: ReadonlyMap<CrumbStatus, string>;
}) {
  return (
    <>
      {item.status ? (
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[item.status])}
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <StatusText item={item} statusText={statusText} />
      {item.hint ? (
        <span className="shrink-0 text-[11px] text-[#9b9fb3]">{item.hint}</span>
      ) : null}
    </>
  );
}

/**
 * Строка журнала с вложенным списком его документов.
 *
 * Документы грузятся при первом раскрытии подменю, а не вместе со
 * страницей: журналов в наборе три-четыре десятка, и тянуть документы
 * всех сразу — тридцать пять лишних запросов ради одного открытого
 * подменю.
 */
function JournalRowWithDocuments({
  item,
  journalCode,
  onNavigate,
  navigate,
  statusText,
  holdFocus,
}: {
  item: CrumbMenuItem;
  journalCode: string;
  onNavigate: () => void;
  /** Общий с родительской крошкой переход (см. `useTransition` в `CrumbNode`). */
  navigate: (href: string) => void;
  statusText: ReadonlyMap<CrumbStatus, string>;
  /** Пока в поиске есть текст — наведение не уводит фокус из поля. */
  holdFocus?: (event: ReactPointerEvent) => void;
}) {
  const [documents, setDocuments] = useState<CrumbMenuItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  // Тип указателя запоминаем на pointerdown: у синтезированного click
  // pointerType в части браузеров пустой, и отличить тап от мыши внутри
  // самого click надёжно нельзя.
  const pointerType = useRef<string>("mouse");

  const load = useCallback(() => {
    if (documents !== null || loading) return;
    setLoading(true);
    fetch(`/api/journals/${journalCode}/documents-menu`)
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => setDocuments((data?.items as CrumbMenuItem[]) ?? []))
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, [documents, journalCode, loading]);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        onPointerDown={(e) => {
          pointerType.current = e.pointerType || "mouse";
        }}
        onPointerEnter={load}
        onPointerMove={holdFocus}
        onPointerLeave={holdFocus}
        onFocus={load}
        onClick={(e) => {
          // Тач и перо: ховера нет, а Radix раскрывает подменю указателем
          // только для мыши. Отдаём click ему — иначе документы журнала
          // недостижимы с телефона.
          if (pointerType.current !== "mouse") return;
          // Мышь: подменю и так раскрыто наведением, поэтому клик по строке
          // остаётся быстрым переходом в сам журнал — самый частый сценарий.
          e.preventDefault();
          onNavigate();
          navigate(item.href);
        }}
        className={cn(
          ITEM_CLASS,
          "min-w-0 data-[state=open]:bg-[#fafbff]",
          item.current && CURRENT_ITEM_CLASS,
        )}
      >
        <MenuRow item={item} statusText={statusText} />
      </DropdownMenuSubTrigger>
      {/* Портал обязателен: без него подменю обрежется скроллом родительского
          списка (у него overflow-y-auto под длинный набор журналов). */}
      <DropdownMenuPortal>
        <DropdownMenuSubContent alignOffset={-4} className={SUBPANEL_CLASS}>
          <div className={PANEL_LABEL_CLASS}>Документы журнала</div>
          {loading || documents === null ? (
            <div className="flex items-center gap-2 px-2 py-2 text-[12px] text-[#9b9fb3]">
              <Loader2 className="size-3.5 animate-spin" />
              Загружаем
            </div>
          ) : documents.length === 0 ? (
            <div className="px-2 py-2 text-[12px] text-[#9b9fb3]">
              Документов пока нет
            </div>
          ) : (
            documents.map((doc) => (
              <DropdownMenuItem
                key={doc.href}
                onSelect={() => {
                  onNavigate();
                  navigate(doc.href);
                }}
                className={cn(ITEM_CLASS, "min-w-0")}
              >
                <MenuRow item={doc} statusText={DOCUMENT_STATUS_TEXT} />
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}
