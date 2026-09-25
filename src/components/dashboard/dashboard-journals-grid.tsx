"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  Printer,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { journalMatchesQuery, normalizeJournalSearch } from "@/lib/journal-search";
import { customJournalName } from "@/lib/custom-names";
import { useCustomNames } from "@/components/shared/custom-names-provider";
import { cn } from "@/lib/utils";

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
 * Сетка журналов на дашборде + поиск над ней.
 *
 * Поиск ищет и по отключённым журналам, хотя сама секция называется
 * «Обязательные»: искать приходят как раз тогда, когда нужного журнала на
 * дашборде нет — а нет его ровно потому, что он отключён. Найденные
 * отключённые показываются отдельной группой ниже и включаются оттуда же
 * одной кнопкой: включить безопасно, ничего не теряется.
 *
 * Карточки жили в `dashboard/page.tsx`; переехали сюда целиком, потому
 * что фильтрация — клиентская, а разметку дублировать нельзя.
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

export function DashboardJournalsGrid({
  items: rawItems,
  paperItems,
  disabledItems: rawDisabledItems,
  disabledCodes,
  sampleCodes,
  canToggle,
}: {
  items: DashboardJournalItem[];
  paperItems: DashboardPaperItem[];
  /** Отключённые журналы — показываются только в результатах поиска. */
  disabledItems: DashboardDisabledItem[];
  /** Полный список отключённых кодов: PATCH ждёт набор, а не дельту. */
  disabledCodes: string[];
  sampleCodes: string[];
  canToggle: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeJournalSearch(deferredQuery);
  const [enablingCode, setEnablingCode] = useState<string | null>(null);
  const samples = useMemo(() => new Set(sampleCodes), [sampleCodes]);
  // Свои названия журналов организации («Настройки → Названия»).
  const customNames = useCustomNames();
  const items = useMemo(
    () => rawItems.map((item) => withCustomName(item, customJournalName(customNames, item.code))),
    [rawItems, customNames],
  );
  const disabledItems = useMemo(
    () =>
      rawDisabledItems.map((item) => withCustomName(item, customJournalName(customNames, item.code))),
    [rawDisabledItems, customNames],
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
      paperItems.filter((paper) => journalMatchesQuery([paper.name, paper.id], normalizedQuery)),
    [paperItems, normalizedQuery],
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
        throw new Error(body?.error || "Не удалось включить журнал");
      }
      toast.success(`Журнал включён: ${name}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось включить журнал");
    } finally {
      setEnablingCode(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-[420px]">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти журнал, даже отключённый"
            aria-label="Поиск по журналам"
            className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white pl-11 pr-11 text-[15px] text-[#0b1024] placeholder:truncate placeholder:text-[#c1c5d6] max-sm:text-[14px] shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-[border-color,box-shadow] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Очистить поиск"
              className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[#9b9fb3] transition-colors hover:bg-[#f5f6ff] hover:text-[#5566f6] touch:min-w-8"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        {normalizedQuery ? (
          <div className="text-[13px] text-[#6f7282] sm:whitespace-nowrap">
            Найдено {foundCount} из {totalCount}
          </div>
        ) : null}
      </div>

      {normalizedQuery && foundCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">Ничего не нашли</div>
          <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] text-[#6f7282]">
            Поиск идёт по названию, описанию и коду журнала — включая те, что
            отключены для вашей организации.
          </p>
        </div>
      ) : null}

      {foundItems.length > 0 || foundPaper.length > 0 ? (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {foundItems.map((item) => (
            <Link
              key={item.id}
              href={`/journals/${item.code}`}
              className={cn(
                "group flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border transition-colors duration-150",
                // Без свечения и подпрыгивания: статус читается по цвету
                // рамки и подложки, hover — только рамка.
                item.filled
                  ? "border-[#c8f0d5] hover:border-[#7cf5c0]"
                  : "border-[#ffd2cd] hover:border-[#ff8d7d]",
              )}
            >
              {/* Превью: снимок первой страницы своего документа, если cron
                  уже отрисовал, иначе стандартный образец бланка — по
                  названию вроде «Чек-лист (памятка) проведения санитарного
                  дня» невозможно вспомнить, что там за форма.

                  На телефоне превью скрыто: в карточке шириной 165 px
                  бумажный бланк с пропорциями 1228×862 превращается в
                  нечитаемую полоску 119 px, а тридцать четыре таких
                  полоски растягивали дашборд на семь экранов. */}
              {item.previewUrl || samples.has(item.code) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.previewUrl ?? `/journal-samples/${item.code}.webp`}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  fetchPriority="low"
                  width={768}
                  height={539}
                  className="hidden aspect-[1228/862] w-full border-b border-[#ececf4] bg-white object-cover object-top sm:block"
                />
              ) : null}

              <span
                className={cn(
                  // flex-1: в ряду карточки одной высоты, но у одних
                  // заголовок в строку, у других в две. Без растяжения
                  // цветная полоса кончалась по тексту и под ней
                  // оставалась белая щель до низа карточки.
                  "flex min-w-0 flex-1 items-center gap-2.5 px-3.5 py-3 text-[14px]",
                  item.filled ? "bg-[#effaf1]" : "bg-[#fff4f2]",
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg",
                    item.filled
                      ? "bg-[#d9f4e1] text-[#136b2a]"
                      : "bg-[#ffe1dc] text-[#d2453d]",
                  )}
                >
                  {item.filled ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <XCircle className="size-4" />
                  )}
                </span>
                <span
                  className={cn(
                    "line-clamp-2 min-w-0 flex-1 break-words text-[15px] font-semibold leading-snug tracking-[-0.01em]",
                    item.filled ? "text-[#136b2a]" : "text-[#a1362f]",
                  )}
                  title={item.officialName ? `Официальное название: ${item.officialName}` : undefined}
                >
                  {item.name}
                </span>
                <ArrowRight
                  className={cn(
                    "size-4 shrink-0 transition-transform group-hover:translate-x-0.5",
                    item.filled ? "text-[#7cf5c0]" : "text-[#ffb0a6]",
                  )}
                />
              </span>
            </Link>
          ))}

          {/* Бумажные журналы. Та же геометрия, но нейтральные и без
              статуса: отметить «заполнено» в системе нельзя — подпись
              ставится ручкой на распечатанном листе. */}
          {foundPaper.map((paper) => (
            <Link
              key={paper.id}
              href={`/settings/journals/paper/${paper.id}`}
              className="group flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-[#ececf4] bg-[#fafbff] transition-colors duration-150 hover:border-[#5566f6]/40"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/journal-samples/paper_${paper.id}.webp`}
                alt=""
                loading="lazy"
                className="aspect-[1228/862] w-full border-b border-[#ececf4] bg-white object-cover object-top"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5 px-3.5 py-3">
                <span className="inline-flex w-fit items-center gap-1 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-medium text-[#3848c7]">
                  <Printer className="size-3" />
                  <span className="sm:hidden">Бумажный</span>
                  <span className="hidden sm:inline">Бумажный · распечатать</span>
                </span>
                <span className="line-clamp-3 break-words text-[13px] font-semibold leading-snug tracking-[-0.01em] text-[#0b1024] sm:line-clamp-2 sm:text-[15px]">
                  {paper.name}
                </span>
              </span>
            </Link>
          ))}
        </div>
      ) : null}

      {foundDisabled.length > 0 ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-[14px] font-semibold text-[#0b1024]">Отключённые</h3>
            <p className="text-[13px] text-[#6f7282]">
              не показываются на дашборде и сотрудникам
              {canToggle ? " — включите, если журнал всё-таки нужен" : null}
            </p>
          </div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {foundDisabled.map((item) => (
              <div
                key={item.id}
                className="flex w-full min-w-0 flex-col gap-2 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-3.5 py-3"
              >
                <span className="line-clamp-2 break-words text-[15px] font-semibold leading-snug tracking-[-0.01em] text-[#6f7282]">
                  {item.name}
                </span>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  {canToggle ? (
                    // Включение безопасно — без подтверждения, одно нажатие.
                    <button
                      type="button"
                      onClick={() => void enableJournal(item.code, item.name)}
                      disabled={enablingCode === item.code}
                      className="inline-flex items-center gap-1 rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium text-[#5566f6] transition-colors hover:bg-[#eef1ff] disabled:opacity-60"
                    >
                      <Eye className="size-3.5" />
                      {enablingCode === item.code ? "Включаю…" : "Включить"}
                    </button>
                  ) : (
                    <Link
                      href={`/settings/journals#journal-${item.code}`}
                      className="inline-flex items-center gap-1 rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium text-[#5566f6] hover:bg-[#eef1ff]"
                    >
                      Включить
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
