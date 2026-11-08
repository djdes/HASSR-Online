"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Eye, Printer, Search, X } from "lucide-react";
import { toast } from "sonner";

import { journalMatchesQuery, normalizeJournalSearch } from "@/lib/journal-search";
import { RECENT_JOURNALS_KEY, parseRecentJournals, pickRecentJournals } from "@/lib/recent-journals";
import { useSlashFocus } from "@/components/today/use-slash-focus";
import { customJournalName } from "@/lib/custom-names";
import { sortJournalsByName } from "@/lib/journal-sort";
import { useCustomNames } from "@/components/shared/custom-names-provider";
import {
  DashboardDisabledRow,
  DashboardJournalRow,
  DashboardPaperRow,
  ENABLE_BUTTON_CLASS,
  type JournalThumbSource,
} from "@/components/dashboard/dashboard-journal-row";
import {
  JOURNAL_ITEM_CLASS,
  JOURNAL_LIST_CLASS,
  JOURNAL_TOOLBAR_CLASS,
  splitTodayJournals,
} from "@/components/dashboard/dashboard-journals-layout";
import { useTariffLimitToast } from "@/lib/billing-limit-toast";

/**
 * Своё название организации вместо официального; официальное остаётся
 * в `officialName` — для поиска и подсказки при наведении.
 */
function withCustomName<T extends { code: string; name: string }>(
  item: T,
  custom: string | null,
): T & { officialName?: string } {
  return custom ? { ...item, name: custom, officialName: item.name } : item;
}

/**
 * Список журналов на главной + поиск над ним.
 *
 * Поиск ищет и по отключённым журналам, хотя сама секция называется
 * «Обязательные»: искать приходят как раз тогда, когда нужного журнала на
 * дашборде нет — а нет его ровно потому, что он отключён. Найденные
 * отключённые показываются отдельной группой ниже и включаются оттуда же
 * одной кнопкой: включить безопасно, ничего не теряется.
 *
 * Вид (владелец, 2026-09-27): строки без заливки и рамок — превью бланка,
 * название, отметка «заполнено сегодня». На телефоне одна колонка, на
 * компьютере сетка в 2–3 колонки с превью чуть крупнее.
 */

export type DashboardJournalItem = {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  filled: boolean;
  previewUrl: string | null;
};

export type DashboardPaperItem = {
  id: string;
  name: string;
};

export type DashboardDisabledItem = {
  id: string;
  name: string;
  code: string;
  description?: string | null;
};

/** «Скрыть заполненные» на этом устройстве. */
const HIDE_FILLED_KEY = "wesetup-today-hide-filled";

const GROUP_TITLE_CLASS =
  "text-[12px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]";

/**
 * Превью строки: снимок своего документа (cron `journal-previews`), иначе
 * стандартный образец бланка, иначе — заглушка.
 */
function thumbFor(
  item: { code: string; previewUrl?: string | null },
  samples: Set<string>,
): JournalThumbSource {
  if (item.previewUrl) return { src: item.previewUrl, optimized: false };
  if (samples.has(item.code)) {
    return { src: `/journal-samples/${item.code}.webp`, optimized: true };
  }
  return null;
}

export function DashboardJournalsGrid({
  items: rawItems,
  paperItems,
  disabledItems: rawDisabledItems,
  disabledCodes,
  sampleCodes,
  canToggle,
  actions,
}: {
  items: DashboardJournalItem[];
  paperItems: DashboardPaperItem[];
  /** Отключённые журналы — показываются только в результатах поиска. */
  disabledItems: DashboardDisabledItem[];
  /** Полный список отключённых кодов: PATCH ждёт набор, а не дельту. */
  disabledCodes: string[];
  sampleCodes: string[];
  canToggle: boolean;
  /** Кнопки секции («Автозаполнить», «QR-коды») — в одной панели с поиском. */
  actions?: React.ReactNode;
}) {
  const t = useTranslations("dashboardUi.dashboardJournalsGrid");
  const tSpeed = useTranslations("dashboardUi.todaySpeed");
  const searchRef = useRef<HTMLInputElement>(null);
  // «Недавно открывали» и «Скрыть заполненные» — настройки устройства
  // (localStorage), читаем после гидрации.
  const [recent, setRecent] = useState<string[]>([]);
  const [hideFilled, setHideFilled] = useState(false);
  useEffect(() => {
    try {
      setRecent(parseRecentJournals(window.localStorage.getItem(RECENT_JOURNALS_KEY)));
      setHideFilled(window.localStorage.getItem(HIDE_FILLED_KEY) === "1");
    } catch {
      /* хранилище недоступно — без недавних, заполненные видны */
    }
  }, []);
  // «/» — сразу в поиск журналов.
  useSlashFocus(searchRef);
  function toggleHideFilled() {
    setHideFilled((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(HIDE_FILLED_KEY, next ? "1" : "0");
      } catch {
        /* без хранилища — до перезагрузки */
      }
      return next;
    });
  }
  const router = useRouter();
  const tariffLimit = useTariffLimitToast();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeJournalSearch(deferredQuery);
  const [enablingCode, setEnablingCode] = useState<string | null>(null);
  const samples = useMemo(() => new Set(sampleCodes), [sampleCodes]);
  // Свои названия журналов организации («Настройки → Названия»).
  // Каждый список — по алфавиту по тому названию, которое видит компания.
  const customNames = useCustomNames();
  const items = useMemo(
    () =>
      sortJournalsByName(
        rawItems.map((item) => withCustomName(item, customJournalName(customNames, item.code))),
        (item) => item.name,
      ),
    [rawItems, customNames],
  );
  const disabledItems = useMemo(
    () =>
      sortJournalsByName(
        rawDisabledItems.map((item) =>
          withCustomName(item, customJournalName(customNames, item.code)),
        ),
        (item) => item.name,
      ),
    [rawDisabledItems, customNames],
  );
  const sortedPaperItems = useMemo(
    () => sortJournalsByName(paperItems, (paper) => paper.name),
    [paperItems],
  );

  const foundItems = useMemo(
    () =>
      items.filter((item) =>
        journalMatchesQuery(
          [item.name, item.officialName, item.description, item.code],
          normalizedQuery,
        ),
      ),
    [items, normalizedQuery],
  );
  const foundPaper = useMemo(
    () =>
      sortedPaperItems.filter((paper) =>
        journalMatchesQuery([paper.name, paper.id], normalizedQuery),
      ),
    [sortedPaperItems, normalizedQuery],
  );
  // Отключённые показываем только при поиске: без запроса секция
  // «Обязательные» должна остаться списком того, что реально ведут.
  const foundDisabled = useMemo(
    () =>
      normalizedQuery
        ? disabledItems.filter((item) =>
            journalMatchesQuery(
              [item.name, item.officialName, item.description, item.code],
              normalizedQuery,
            ),
          )
        : [],
    [disabledItems, normalizedQuery],
  );

  // «Сначала то, что осталось»: незаполненные сверху, заполненные — ниже.
  const todayGroups = useMemo(
    () => splitTodayJournals(foundItems, { searching: Boolean(normalizedQuery) }),
    [foundItems, normalizedQuery],
  );
  // Следующий незаполненный — в порядке списка; при поиске — не показываем.
  const unfilledItems = useMemo(() => items.filter((item) => !item.filled), [items]);
  const nextItem = normalizedQuery ? null : (todayGroups.todo.find((item) => !item.filled) ?? null);
  const recentItems = useMemo(() => pickRecentJournals(recent, items), [recent, items]);
  const printHref = `/dashboard/today-print?codes=${encodeURIComponent(unfilledItems.map((item) => item.code).join(","))}`;

  const totalCount = items.length + paperItems.length + disabledItems.length;
  const foundCount = foundItems.length + foundPaper.length + foundDisabled.length;

  async function enableJournal(code: string, name: string) {
    setEnablingCode(code);
    try {
      const res = await fetch("/api/settings/journals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabledCodes: disabledCodes.filter((item) => item !== code) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        // Отказ по лимиту тарифа — toast с кнопкой «Выбрать тариф».
        if (tariffLimit(body)) return;
        throw new Error(body?.error || t("enableFailed"));
      }
      toast.success(t("enabledToast", { name }));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("enableFailed"));
    } finally {
      setEnablingCode(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Панель: поиск слева, кнопки справа — одной строкой, если
          помещаются. Две кнопки («Автозаполнить» и «QR-коды») на телефоне —
          своей строкой во всю ширину над поиском, как раньше. */}
      <div className={JOURNAL_TOOLBAR_CLASS}>
        {actions ? (
          <div className="order-2 shrink-0 has-[[data-journals-actions]]:order-none has-[[data-journals-actions]]:basis-full sm:has-[[data-journals-actions]]:basis-auto lg:order-3 lg:ml-auto lg:has-[[data-journals-actions]]:order-3">
            {actions}
          </div>
        ) : null}
        <div className="relative order-1 min-w-[200px] flex-1 lg:max-w-[420px]">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
          <input
            ref={searchRef}
            data-testid="journal-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchLabel")}
            className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white pl-11 pr-11 text-[15px] text-[#0b1024] placeholder:truncate placeholder:text-[#c1c5d6] max-sm:text-[14px] shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-[border-color,box-shadow] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("clearSearch")}
              className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[#9b9fb3] transition-colors hover:bg-[#f5f6ff] hover:text-[#5566f6] touch:min-w-8"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        {normalizedQuery ? (
          <div className="order-3 basis-full text-[13px] text-[#6f7282] lg:order-2 lg:basis-auto lg:whitespace-nowrap">
            {t("found", { found: foundCount, total: totalCount })}
          </div>
        ) : null}
      </div>

      {/* Недавно открытые на этом устройстве журналы — в одно касание. */}
      {!normalizedQuery && recentItems.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="recent-journals">
          <span className={GROUP_TITLE_CLASS}>{tSpeed("recentTitle")}</span>
          {recentItems.map((item) => (
            <Link
              key={item.id}
              href={`/journals/${item.code}`}
              data-recent-journal={item.code}
              className="inline-flex max-w-full items-center rounded-full border border-[#dcdfed] bg-white px-3.5 py-1.5 text-[13.5px] font-medium text-[#3848c7] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <span className="truncate">{item.name}</span>
            </Link>
          ))}
        </div>
      ) : null}

      {/* Компьютер: «Дальше: <журнал>» и лист на печать — над списком. */}
      {!normalizedQuery && unfilledItems.length > 0 ? (
        <div className="hidden flex-wrap items-center gap-2 md:flex">
          {nextItem ? (
            <Link
              href={`/journals/${nextItem.code}`}
              data-testid="today-next"
              aria-label={tSpeed("nextAria", { name: nextItem.name })}
              className="inline-flex max-w-full items-center gap-2 rounded-2xl bg-[#5566f6] px-4 py-2.5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25"
            >
              <span className="truncate">{tSpeed("next", { name: nextItem.name })}</span>
              <ArrowRight className="size-4 shrink-0" aria-hidden />
            </Link>
          ) : null}
          <Link
            href={printHref}
            data-testid="today-print-link"
            title={tSpeed("printTodayHint")}
            className="inline-flex items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 py-2.5 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            <Printer className="size-4 text-[#5566f6]" aria-hidden />
            {tSpeed("printToday")}
          </Link>
        </div>
      ) : null}

      {normalizedQuery && foundCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">{t("nothingFound")}</div>
          <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] text-[#6f7282]">
            {t("nothingFoundHint")}
          </p>
        </div>
      ) : null}

      {todayGroups.todo.length > 0 ? (
        <ul role="list" className={JOURNAL_LIST_CLASS} data-journal-list="" data-journal-group="todo">
          {todayGroups.todo.map((item) => (
            <li key={item.id} className={JOURNAL_ITEM_CLASS}>
              <DashboardJournalRow
                code={item.code}
                name={item.name}
                officialName={item.officialName}
                filled={item.filled}
                thumb={thumbFor(item, samples)}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {/* Телефон: «Дальше: <журнал>» закреплён у нижнего края экрана; справа
          оставлено место доку плавающих кнопок, под списком — запас высоты,
          чтобы кнопка не закрывала последнюю строку. (`sticky` не работает:
          секция «Обязательные журналы» обрезает содержимое.) */}
      {nextItem ? <div aria-hidden className="h-16 md:hidden" /> : null}
      {nextItem ? (
        <div
          className="fixed left-4 right-[92px] z-30 md:hidden print:hidden"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
          data-testid="today-next-sticky"
        >
          <Link
            href={`/journals/${nextItem.code}`}
            aria-label={tSpeed("nextAria", { name: nextItem.name })}
            className="inline-flex max-w-full items-center gap-2 rounded-2xl bg-[#5566f6] px-4 py-3 text-[15px] font-medium text-white shadow-[0_12px_32px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
          >
            <span className="truncate">{tSpeed("next", { name: nextItem.name })}</span>
            <ArrowRight className="size-4 shrink-0" aria-hidden />
          </Link>
        </div>
      ) : null}

      {/* Заполненные сегодня — ниже незаполненных: сверху то, что осталось. */}
      {todayGroups.done.length > 0 ? (
        <section className="space-y-2" data-filled-group="" data-hidden={hideFilled ? "" : undefined}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className={GROUP_TITLE_CLASS}>{t("filledToday", { count: todayGroups.done.length })}</h3>
            {/* Заполненные можно свернуть: на кухне важен только остаток. */}
            <button
              type="button"
              onClick={toggleHideFilled}
              aria-expanded={!hideFilled}
              data-testid="toggle-filled"
              className="text-[13px] font-medium text-[#5566f6] underline-offset-2 hover:underline touch:min-h-0"
            >
              {hideFilled ? tSpeed("showFilled") : tSpeed("hideFilled")}
            </button>
          </div>
          {hideFilled ? null : (
          <ul role="list" className={JOURNAL_LIST_CLASS} data-journal-list="" data-journal-group="done">
            {todayGroups.done.map((item) => (
              <li key={item.id} className={JOURNAL_ITEM_CLASS}>
                <DashboardJournalRow
                  code={item.code}
                  name={item.name}
                  officialName={item.officialName}
                  filled={item.filled}
                  thumb={thumbFor(item, samples)}
                />
              </li>
            ))}
          </ul>
          )}
        </section>
      ) : null}

      {/* Бумажные журналы: те же строки с превью бланка, без отметки —
          заполняются ручкой на распечатке. */}
      {foundPaper.length > 0 ? (
        <section className="space-y-2" data-paper-list="">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className={GROUP_TITLE_CLASS}>{t("paperJournals")}</h3>
            <p className="text-[13px] text-[#9b9fb3]">{t("paperHint")}</p>
          </div>
          <ul role="list" className={JOURNAL_LIST_CLASS}>
            {foundPaper.map((paper) => (
              <li key={paper.id} className={JOURNAL_ITEM_CLASS}>
                <DashboardPaperRow id={paper.id} name={paper.name} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {foundDisabled.length > 0 ? (
        <section className="space-y-2" data-disabled-list="">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className={GROUP_TITLE_CLASS}>{t("disabled")}</h3>
            <p className="text-[13px] text-[#9b9fb3]">
              {t("disabledHint")}
              {canToggle ? t("disabledEnableHint") : null}
            </p>
          </div>
          <ul role="list" className={JOURNAL_LIST_CLASS}>
            {foundDisabled.map((item) => (
              <li key={item.id} className={JOURNAL_ITEM_CLASS}>
                <DashboardDisabledRow
                  code={item.code}
                  name={item.name}
                  thumb={thumbFor(item, samples)}
                  action={
                    canToggle ? (
                      // Включение безопасно — без подтверждения, одно нажатие.
                      <button
                        type="button"
                        onClick={() => void enableJournal(item.code, item.name)}
                        disabled={enablingCode === item.code}
                        className={ENABLE_BUTTON_CLASS}
                      >
                        <Eye className="size-3.5" />
                        {enablingCode === item.code ? t("enabling") : t("enable")}
                      </button>
                    ) : (
                      <Link href={`/settings/journals#journal-${item.code}`} className={ENABLE_BUTTON_CLASS}>
                        {t("enable")}
                      </Link>
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
