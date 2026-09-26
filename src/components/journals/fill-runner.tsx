"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useKeyboardInset } from "@/lib/use-keyboard-inset";

/**
 * Конвейер заполнения: одна сущность — один экран.
 *
 * Зачем: даже с правильной осью восемь холодильников — это восемь
 * попаданий пальцем по мелким полям в длинном списке, а бракераж по
 * `docs/JOURNAL-SPECS.md` заполняют 5–50 раз за смену. Так работают
 * мобильные инспекции (iAuditor: «одно поле на экран» + переход к
 * следующему незаполненному).
 *
 * Два режима:
 *  - конечный (`items`): обойти N сущностей и закончить сводкой;
 *  - rolling (`rolling`): после сохранения сразу открывается следующая
 *    пустая форма, пока не нажали «Готово на сегодня».
 */
export type FillRunnerStep = {
  id: string;
  /** Кто или что заполняется на этом экране. */
  title: string;
  subtitle?: string;
  /** Уже заполнено — конвейер такие пропускает при старте. */
  done?: boolean;
  /** Содержимое экрана: поля этой сущности. */
  render: () => React.ReactNode;
};

export function FillRunner({
  open,
  title,
  steps,
  onClose,
  onFinish,
  rolling,
}: {
  open: boolean;
  title: string;
  steps: FillRunnerStep[];
  onClose: () => void;
  /** Вызывается по кнопке «Готово» на сводке. */
  onFinish?: () => void;
  /** Rolling-режим: «Сохранить и следующая» вместо обхода списка. */
  rolling?: { onNext: () => void; onDone: () => void; countToday: number };
}) {
  const [index, setIndex] = useState(0);
  const keyboardInset = useKeyboardInset();

  // При открытии встаём на первую незаполненную сущность — «перейти к
  // следующему незаполненному» вместо «начать сначала».
  useEffect(() => {
    if (!open) return;
    const firstPending = steps.findIndex((step) => !step.done);
    setIndex(firstPending >= 0 ? firstPending : 0);
    // Пересчитывать при каждом изменении шагов не нужно: это стартовая
    // позиция, дальше пользователь управляет сам.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const total = steps.length;
  const current = steps[index];
  const filled = steps.filter((step) => step.done).length;
  const atEnd = index >= total - 1;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-white">
      <header className="shrink-0 border-b border-[#ececf4] px-4 pb-3 pt-[max(0.75rem,var(--safe-t))]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[16px] font-semibold leading-tight text-[#0b1024]">
              {title}
            </div>
            <div className="mt-0.5 text-[12.5px] text-[#6f7282] tabular-nums">
              {rolling
                ? `Записей за сегодня: ${rolling.countToday}`
                : `${index + 1} из ${total} · заполнено ${filled}`}
            </div>
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f5f6ff] text-[#6f7282] transition-colors hover:bg-[#eef1ff] hover:text-[#0b1024]"
          >
            <X className="size-4" />
          </button>
        </div>

        {!rolling && total > 1 ? (
          <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-[#ececf4]">
            <div
              className="h-full rounded-full bg-[#5566f6] transition-[width] duration-200"
              style={{ width: `${Math.round(((index + 1) / total) * 100)}%` }}
            />
          </div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
        {current ? (
          <>
            <div className="mb-4">
              <div className="text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">
                {current.title}
              </div>
              {current.subtitle ? (
                <div className="mt-1 text-[13.5px] text-[#6f7282]">
                  {current.subtitle}
                </div>
              ) : null}
            </div>
            {current.render()}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <CheckCircle2 className="size-10 text-[#116b2a]" />
            <div className="text-[17px] font-semibold text-[#0b1024]">
              Всё заполнено
            </div>
          </div>
        )}
      </div>

      <footer
        className="shrink-0 border-t border-[#ececf4] bg-white px-4 py-3"
        style={{
          paddingBottom: `max(0.75rem, calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + ${keyboardInset}px))`,
        }}
      >
        {rolling ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={rolling.onDone}
              className="h-12 flex-1 rounded-2xl border border-[#dcdfed] bg-white text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:bg-[#fafbff]"
            >
              Готово на сегодня
            </button>
            <button
              type="button"
              onClick={rolling.onNext}
              className="inline-flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]"
            >
              Сохранить и следующая
              <ArrowRight className="size-4" />
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => setIndex((value) => Math.max(0, value - 1))}
              className="inline-flex h-12 items-center justify-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] font-medium text-[#0b1024] transition-colors duration-150 hover:bg-[#fafbff] disabled:opacity-40"
            >
              <ArrowLeft className="size-4" />
              Назад
            </button>
            <button
              type="button"
              onClick={() => {
                if (atEnd) {
                  onFinish?.();
                  onClose();
                  return;
                }
                setIndex((value) => Math.min(total - 1, value + 1));
              }}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]"
            >
              {atEnd ? "Готово" : "Дальше"}
              {atEnd ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <ArrowRight className="size-4" />
              )}
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}
