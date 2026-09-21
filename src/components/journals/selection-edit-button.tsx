"use client";

import { Copy, ListChecks, Pencil, Signature } from "lucide-react";

import { Button } from "@/components/ui/button";
import { selectionEditLabel } from "@/components/journals/sequential-edit";

/**
 * «Изменить» в полосе выделения строк (`JournalSelectionBar` children).
 * Одна строка — окно с её значениями; несколько — те же окна по очереди
 * с «(k из N)» в заголовке.
 */
export function SelectionEditButton({
  count,
  onClick,
  disabled,
}: {
  count: number;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled || count === 0}
      title={count > 1 ? "Открыть окно правки для каждой выделенной строки по очереди" : "Открыть окно правки выбранной строки"}
      onClick={onClick}
      data-testid="selection-edit"
      className="h-10 gap-1.5 rounded-xl border-[#dcdfed] px-3.5 text-[14px] font-semibold text-[#5566f6] shadow-none transition-colors duration-150 hover:bg-[#f3f4fe] hover:text-[#5566f6]"
    >
      <Pencil className="size-4" />
      {selectionEditLabel(count)}
    </Button>
  );
}

const SECONDARY_CLASS =
  "h-10 gap-1.5 rounded-xl border-[#dcdfed] px-3.5 text-[14px] font-semibold text-[#3c4053] shadow-none transition-colors duration-150 hover:bg-[#f3f4fe] hover:text-[#5566f6]";

/** «Применить ко всем» — одно окно меняет отмеченные поля у всех выделенных (показывается от двух строк). */
export function SelectionApplyButton({ count, onClick, disabled }: { count: number; onClick: () => void; disabled?: boolean }) {
  if (count < 2) return null;
  return (
    <Button type="button" variant="outline" disabled={disabled} onClick={onClick} data-testid="selection-apply" title="Заменить отмеченные поля сразу у всех выделенных строк" className={SECONDARY_CLASS}>
      <ListChecks className="size-4" />
      Применить ко всем
    </Button>
  );
}

/** «Повторить строку» — копия выделенных строк с текущим временем (повторная партия того же блюда). */
export function SelectionRepeatButton({ count, onClick, disabled }: { count: number; onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" variant="outline" disabled={disabled || count === 0} onClick={onClick} data-testid="selection-repeat" title="Добавить копию выделенных строк с текущим временем" className={SECONDARY_CLASS}>
      <Copy className="size-4" />
      {count > 1 ? `Повторить · ${count}` : "Повторить строку"}
    </Button>
  );
}

/**
 * «Подписать» в полосе выделения бракеража — видна только члену комиссии.
 * Подпись ставится от имени вошедшего человека, за другого подписать нельзя.
 */
export function SelectionSignButton({ count, onClick, disabled, busy }: { count: number; onClick: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <Button
      type="button"
      disabled={disabled || busy || count === 0}
      onClick={onClick}
      data-testid="selection-sign"
      title="Поставить вашу подпись члена комиссии под выделенными строками"
      className="h-10 gap-1.5 rounded-xl bg-[#5566f6] px-3.5 text-[14px] font-semibold text-white shadow-none transition-colors duration-150 hover:bg-[#4a5bf0]"
    >
      <Signature className="size-4" />
      {busy ? "Подписываем…" : count > 1 ? `Подписать · ${count}` : "Подписать"}
    </Button>
  );
}
