"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Search, X } from "lucide-react";
import { toast } from "sonner";

import { journalMatchesQuery, normalizeJournalSearch } from "@/lib/journal-search";
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
} from "@/components/dashboard/dashboard-journals-layout";

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
  const router = useRouter();
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
    <div className="space-y-5">
      {/* Панель: на телефоне кнопки строкой и поиск под ними, на
          компьютере — поиск слева, кнопки справа, одной строкой. */}
      <div className={JOURNAL_TOOLBAR_CLASS}>
        {actions ? <div className="lg:order-3 lg:ml-auto">{actions}</div> : null}
        <div className="relative w-full lg:order-1 lg:max-w-[420px]">
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
          <div className="text-[13px] text-[#6f7282] lg:order-2 lg:whitespace-nowrap">
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

      {foundItems.length > 0 ? (
        <ul role="list" className={JOURNAL_LIST_CLASS} data-journal-list="">
          {foundItems.map((item) => (
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

      {/* Бумажные журналы: те же строки с превью бланка, без отметки —
          заполняются ручкой на распечатке. */}
      {foundPaper.length > 0 ? (
        <section className="space-y-2" data-paper-list="">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className={GROUP_TITLE_CLASS}>Бумажные журналы</h3>
            <p className="text-[13px] text-[#9b9fb3]">распечатать и вести от руки</p>
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
            <h3 className={GROUP_TITLE_CLASS}>Отключённые</h3>
            <p className="text-[13px] text-[#9b9fb3]">
              не показываются на дашборде и сотрудникам
              {canToggle ? " — включите, если журнал всё-таки нужен" : null}
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
                        {enablingCode === item.code ? "Включаю…" : "Включить"}
                      </button>
                    ) : (
                      <Link href={`/settings/journals#journal-${item.code}`} className={ENABLE_BUTTON_CLASS}>
                        Включить
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
