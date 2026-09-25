"use client";

import { AlertTriangle, CheckCircle2, ClipboardList } from "lucide-react";

type Props = {
  /** Сколько уже заполнено на сегодня. */
  filled: number;
  /** Сколько всего нужно заполнить на сегодня. */
  total: number;
  /**
   * Что считаем — подставляется в текст «Сегодня осталось: N из M
   * <label>» («сотрудников», «помещений», «единиц оборудования»).
   */
  label?: string;
  /** Скролл к сегодняшней колонке/строке. Не передан — кнопка «Перейти» не рендерится. */
  onJumpToToday?: () => void;
  /**
   * «Заполнено, но не всё хорошо». Когда всё на сегодня внесено, но
   * среди значений есть выходящие за норму, зелёная плашка врала:
   * человек читал её как «день закрыт» и уходил, не описав, что сделал
   * с отклонением. Текст показываем янтарным вместо зелёного.
   */
  warning?: string | null;
  /** Подпись кнопки рядом с предупреждением («Что сделали?»). */
  warningActionLabel?: string;
  /** Клик по этой кнопке — например, прокрутка к корректирующим действиям. */
  onWarningAction?: () => void;
};

/**
 * Полоса «сколько осталось заполнить сегодня» — ставится сразу под
 * шапкой документа. Только отображение: расчёт filled/total делает
 * вызывающий клиент (useMemo по своим данным), этот компонент ничего
 * не грузит и не хранит собственного состояния.
 *
 * `total === 0` — считать нечего (документ без строк на сегодня или
 * сегодня вне периода) — ничего не рисуем.
 */
export function TodayProgressStrip({
  filled,
  total,
  label,
  onJumpToToday,
  warning = null,
  warningActionLabel,
  onWarningAction,
}: Props) {
  if (total === 0) return null;

  if (filled >= total && warning) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-[#f2d6a8] bg-[#fff8ec] px-4 py-2.5 text-[13.5px] font-medium text-[#8a5a12] print:hidden">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">Сегодня всё заполнено · {warning}</span>
        {onWarningAction ? (
          <button
            type="button"
            onClick={onWarningAction}
            className="inline-flex shrink-0 items-center rounded-full border border-[#d9a441]/40 bg-white/70 px-3.5 py-1.5 text-[12.5px] font-semibold text-[#8a5a12] transition-colors duration-150 hover:border-[#d9a441] hover:bg-white focus:outline-none focus-visible:ring-4 focus-visible:ring-[#d9a441]/20 max-sm:min-h-[36px] touch:min-h-12"
          >
            {warningActionLabel ?? "Перейти"}
          </button>
        ) : null}
      </div>
    );
  }

  if (filled >= total) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-[#c9f0da] bg-[#ecfdf5] px-4 py-2.5 text-[13.5px] font-medium text-[#116b2a] print:hidden">
        <CheckCircle2 className="size-4 shrink-0" />
        Сегодня всё заполнено
      </div>
    );
  }

  const remaining = total - filled;
  const percent = Math.max(0, Math.min(100, Math.round((filled / total) * 100)));
  const labelSuffix = label ? ` ${label}` : "";

  return (
    <div className="rounded-2xl bg-[#f5f6ff] px-4 py-2.5 text-[13.5px] text-[#3848c7] print:hidden">
      <div className="flex items-center gap-2.5">
        <ClipboardList className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          Сегодня осталось: <span className="font-semibold">{remaining} из {total}</span>
          {labelSuffix}
        </span>
        {onJumpToToday ? (
          <button
            type="button"
            onClick={onJumpToToday}
            className="inline-flex shrink-0 items-center rounded-full border border-[#5566f6]/25 bg-white/70 px-3.5 py-1.5 text-[12.5px] font-semibold text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-white focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 max-sm:min-h-[36px] touch:min-h-12"
          >
            Перейти
          </button>
        ) : null}
      </div>
      {/* Полоса нужна, когда есть что делить: на одном-двух пунктах
          она читается как пустая серая линия и только мешает. */}
      {total > 2 ? (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[#dcdfed]">
          <div
            className="h-full rounded-full bg-[#5566f6] transition-[width] duration-200"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
