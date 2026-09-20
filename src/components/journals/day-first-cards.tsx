"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Pencil, Search, SlidersHorizontal } from "lucide-react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { BottomActionBar } from "@/components/journals/bottom-action-bar";
import { SwipeRow } from "@/components/journals/swipe-row";
import { useJournalUndo } from "@/components/journals/use-journal-undo";
import { haptic } from "@/app/mini/_components/use-haptic";
import {
  filterDayItems,
  nextUnfilledId,
  type DayFilter,
} from "@/components/journals/day-first-logic";

/**
 * Карточки «Сегодня → кто/что».
 *
 * Зачем: карточный режим матричных журналов был построен по оси
 * сущности — раскрываешь сотрудника (холодильник, помещение), а внутри
 * все 15–31 день периода. Но ежедневная работа обратная: «отметить
 * сегодня по всем». Чтобы закрыть смену на двадцати сотрудниках, надо
 * было раскрыть каждого и найти сегодняшнюю строку среди пятнадцати.
 *
 * Здесь один экран = один день: плоский список сущностей, у каждой одно
 * значение и одно касание. Ось «по сотрудникам» никуда не делась — она
 * нужна, когда догоняешь пропущенные дни, и переключается в шапке.
 *
 * Ввод устроен слоями, от самого быстрого к самому подробному:
 *
 *   1. смахнуть вправо — поставить обычное значение, не целясь;
 *   2. нажать кнопку — открыть выбор значения листом снизу;
 *   3. массовая кнопка — отметить всех оставшихся разом.
 *
 * Каждый слой обратим: всё, что ставится одним движением, кладёт тост
 * «Вернуть». Без него люди не пользуются быстрым вводом — массовая
 * кнопка существовала и раньше, но нажимать её боялись.
 */
export type DayFirstItem = {
  id: string;
  /** Кто или что: сотрудник, холодильник, помещение. */
  title: string;
  subtitle?: string;
  /** Текущее значение за сегодня. Пусто — ещё не заполнено. */
  value?: React.ReactNode;
  /** Что произойдёт по нажатию — обычно открывается выбор значения. */
  onPress?: (event: React.MouseEvent) => void;
  /** Заблокировано (закрытый день, нет прав) — с причиной. */
  disabledReason?: string | null;
  /** Своя правая часть вместо значения: поле ввода, чипы. */
  trailing?: React.ReactNode;
  /**
   * Открыть карточку сущности (название, норма, QR) — круглый карандаш
   * рядом с названием. Не передан — карандаша нет.
   */
  onEdit?: () => void;
  /** Подпись карандаша для скринридера и подсказки. */
  editLabel?: string;
  /**
   * Быстрая отметка смахиванием вправо. Журнал сам решает, что считать
   * обычным значением: «Зд.» у гигиенического, «выполнено» у уборки.
   * Не передана — свайпа вправо у строки нет.
   */
  quickMark?: {
    label: string;
    onApply: () => void;
    onUndo: () => void;
  };
};

export function DayFirstCards({
  items,
  emptyLabel = "На сегодня заполнять нечего.",
  bulkAction,
}: {
  items: DayFirstItem[];
  emptyLabel?: string;
  /** Действие «отметить всех» — показывается, пока есть незаполненные. */
  bulkAction?: {
    label: string;
    onRun: () => void;
    disabled?: boolean;
    /**
     * Вернуть как было. Не передана — кнопка работает как раньше, с
     * подтверждением вместо отмены. Прятать её без отмены нельзя: она
     * уже есть у журналов, и исчезновение читалось бы как поломка.
     */
    onUndo?: () => void;
  };
}) {
  const undo = useJournalUndo();
  const [filter, setFilter] = useState<DayFilter>({ query: "", onlyPending: false });
  const [filterOpen, setFilterOpen] = useState(false);

  const visible = useMemo(() => filterDayItems(items, filter), [items, filter]);
  const pending = items.filter((item) => !item.value && !item.disabledReason);

  // Поиск нужен не всегда: на пяти холодильниках он только занимает
  // место. Порог — когда список перестаёт помещаться на экран целиком.
  const showFilter = items.length >= 12;
  const filterActive = filter.onlyPending || filter.query.trim() !== "";

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-5 text-center text-[13px] text-[#6f7282]">
        {emptyLabel}
      </div>
    );
  }

  /** Увести к следующей незаполненной строке — конвейер вместо поиска глазами. */
  function focusNext(afterId: string) {
    const nextId = nextUnfilledId(items, afterId);
    if (!nextId) return;
    const node = document.querySelector(`[data-day-row="${nextId}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="space-y-2">
      {showFilter ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            className={`flex min-h-[44px] flex-1 items-center gap-2 rounded-2xl border px-3 text-[13px] font-medium transition-colors ${
              filterActive
                ? "border-[#5566f6]/40 bg-[#f5f6ff] text-[#3848c7]"
                : "border-[#dcdfed] bg-white text-[#6f7282]"
            }`}
          >
            <Search className="size-4" />
            {filterActive
              ? `Показано ${visible.length} из ${items.length}`
              : "Найти или отфильтровать"}
          </button>
          {filterActive ? (
            <button
              type="button"
              onClick={() => setFilter({ query: "", onlyPending: false })}
              className="min-h-[44px] rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#6f7282]"
            >
              Сбросить
            </button>
          ) : null}
        </div>
      ) : null}

      {bulkAction && pending.length > 1 ? (
        <button
          type="button"
          onClick={() => {
            haptic("success");
            const count = pending.length;
            const revert = bulkAction.onUndo;
            bulkAction.onRun();
            if (revert) undo({ label: `Отмечено: ${count}`, onUndo: revert });
          }}
          disabled={bulkAction.disabled}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-[#5566f6]/25 bg-[#f5f6ff] px-4 text-[14px] font-semibold text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/45 hover:bg-[#eef1ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60"
        >
          <CheckCircle2 className="size-4" />
          {bulkAction.label} · {pending.length}
        </button>
      ) : null}

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-5 text-center text-[13px] text-[#6f7282]">
          Ничего не найдено. Измените запрос или сбросьте фильтр.
        </div>
      ) : null}

      {visible.map((item) => {
        const locked = Boolean(item.disabledReason);
        const filled = Boolean(item.value);

        const row = (
          <div
            data-day-row={item.id}
            // Телефон + широкий `trailing` (поле температуры с ± и кнопками):
            // в одну строку название сжималось до «Холоди…», а камера вылезала
            // за карточку. Переносим управление на вторую строку.
            className={`flex items-center gap-3 border px-3 py-2.5 ${
              item.trailing ? "max-sm:flex-wrap" : ""
            } ${
              filled
                ? "border-[#ececf4] bg-white"
                : locked
                  ? "border-[#ececf4] bg-[#fafbff]"
                  : "border-[#dfe3f5] bg-[#fbfcff]"
            } rounded-2xl`}
          >
            {/* Полоса состояния: заполнено читается боковым зрением,
                без чтения текста в каждой строке. */}
            <span
              aria-hidden
              className="h-8 w-1 shrink-0 rounded-full"
              style={{
                background: locked
                  ? "#dcdfed"
                  : filled
                    ? "#7cf5c0"
                    : "#f0b429",
              }}
            />

            <div className="min-w-0 flex-1">
              <div className="line-clamp-3 break-words text-[14px] font-medium leading-snug text-[#0b1024]">
                {item.title}
              </div>
              {item.subtitle ? (
                <div className="line-clamp-2 break-words text-[12px] text-[#6f7282]">
                  {item.subtitle}
                </div>
              ) : null}
              {locked ? (
                <div className="mt-0.5 break-words text-[11px] text-[#9b9fb3]">
                  {item.disabledReason}
                </div>
              ) : null}
            </div>

            {item.onEdit ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  item.onEdit?.();
                }}
                title={item.editLabel ?? `Изменить ${item.title}`}
                aria-label={item.editLabel ?? `Изменить ${item.title}`}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-[#9b9fb3] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                <Pencil className="size-4" />
              </button>
            ) : null}

            {item.trailing ? (
              <div className="shrink-0 max-sm:flex max-sm:w-full max-sm:justify-end">{item.trailing}</div>
            ) : (
              <button
                type="button"
                onClick={(event) => {
                  haptic("light");
                  item.onPress?.(event);
                }}
                disabled={locked || !item.onPress}
                className={`flex min-h-[44px] max-w-[48%] shrink-0 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-60 ${
                  filled
                    ? "border-[#ececf4] bg-[#f5f6ff] text-[#3848c7] hover:bg-[#eef1ff]"
                    : "border-[#dcdfed] bg-white text-[#6f7282] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                }`}
              >
                <span className="min-w-0 truncate">
                  {filled ? item.value : "Заполнить"}
                </span>
                {!locked ? <ChevronRight className="size-3.5 shrink-0" /> : null}
              </button>
            )}
          </div>
        );

        const quick = item.quickMark;
        if (!quick || locked || filled) {
          return <div key={item.id}>{row}</div>;
        }

        return (
          <SwipeRow
            key={item.id}
            right={{
              label: quick.label,
              tone: "ok",
              icon: <CheckCircle2 className="size-4" />,
              onRun: () => {
                quick.onApply();
                undo({
                  label: `${item.title} — ${quick.label}`,
                  onUndo: quick.onUndo,
                });
                focusNext(item.id);
              },
            }}
            left={
              item.onPress
                ? {
                    label: "Выбрать",
                    tone: "neutral",
                    icon: <SlidersHorizontal className="size-4" />,
                    onRun: () =>
                      item.onPress?.({} as React.MouseEvent),
                  }
                : undefined
            }
          >
            {row}
          </SwipeRow>
        );
      })}

      {/* Главное действие смены — у большого пальца, а не над списком
          из двадцати строк, до которого надо доскроллить обратно. */}
      <BottomActionBar
        hint={
          pending.length > 0
            ? `Осталось заполнить: ${pending.length} из ${items.length}`
            : null
        }
        primary={
          pending.length > 0 && pending[0].onPress
            ? {
                label:
                  pending.length === 1
                    ? `Заполнить: ${pending[0].title}`
                    : `Заполнить оставшиеся · ${pending.length}`,
                onRun: () => {
                  const target = pending[0];
                  document
                    .querySelector(`[data-day-row="${target.id}"]`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  target.onPress?.({} as React.MouseEvent);
                },
              }
            : null
        }
      />

      <BottomSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Поиск и фильтр"
        subtitle={`Всего строк: ${items.length}`}
      >
        <div className="space-y-3 pb-2">
          <input
            autoFocus
            value={filter.query}
            onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
            placeholder="Фамилия, помещение, оборудование"
            className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
          <button
            type="button"
            onClick={() =>
              setFilter((f) => ({ ...f, onlyPending: !f.onlyPending }))
            }
            className={`flex min-h-[52px] w-full items-center justify-between rounded-2xl border px-4 text-[14px] font-medium transition-colors ${
              filter.onlyPending
                ? "border-[#5566f6] bg-[#f5f6ff] text-[#3848c7]"
                : "border-[#dcdfed] bg-white text-[#0b1024]"
            }`}
          >
            Только незаполненные
            <span className="text-[13px] text-[#6f7282]">{pending.length}</span>
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
