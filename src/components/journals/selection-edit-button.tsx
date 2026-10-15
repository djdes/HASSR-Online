"use client";

import { Copy, ListChecks, Pencil, Signature } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("journalControls.selection");
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled || count === 0}
      title={t(count > 1 ? "editManyHint" : "editHint")}
      onClick={onClick}
      data-testid="selection-edit"
      className="h-10 gap-1.5 rounded-xl border-[#dcdfed] px-3.5 text-[14px] font-semibold text-[#5566f6] shadow-none transition-colors duration-150 hover:bg-[#f3f4fe] hover:text-[#5566f6]"
    >
      <Pencil className="size-4" />
      {count > 1 ? t("editMany", { count }) : t("edit")}
    </Button>
  );
}

const SECONDARY_CLASS =
  "h-10 gap-1.5 rounded-xl border-[#dcdfed] px-3.5 text-[14px] font-semibold text-[#3c4053] shadow-none transition-colors duration-150 hover:bg-[#f3f4fe] hover:text-[#5566f6]";

/** «Применить ко всем» — одно окно меняет отмеченные поля у всех выделенных (показывается от двух строк). */
export function SelectionApplyButton({ count, onClick, disabled }: { count: number; onClick: () => void; disabled?: boolean }) {
  const t = useTranslations("journalControls.selection");
  if (count < 2) return null;
  return (
    <Button type="button" variant="outline" disabled={disabled} onClick={onClick} data-testid="selection-apply" title={t("applyHint")} className={SECONDARY_CLASS}>
      <ListChecks className="size-4" />
      {t("apply")}
    </Button>
  );
}

/** «Повторить строку» — копия выделенных строк с текущим временем (повторная партия того же блюда). */
export function SelectionRepeatButton({ count, onClick, disabled }: { count: number; onClick: () => void; disabled?: boolean }) {
  const t = useTranslations("journalControls.selection");
  return (
    <Button type="button" variant="outline" disabled={disabled || count === 0} onClick={onClick} data-testid="selection-repeat" title={t("repeatHint")} className={SECONDARY_CLASS}>
      <Copy className="size-4" />
      {count > 1 ? t("repeatMany", { count }) : t("repeat")}
    </Button>
  );
}

/**
 * «Подписать» в полосе выделения бракеража — видна только члену комиссии.
 * Подпись ставится от имени вошедшего человека, за другого подписать нельзя.
 */
export function SelectionSignButton({ count, onClick, disabled, busy }: { count: number; onClick: () => void; disabled?: boolean; busy?: boolean }) {
  const t = useTranslations("journalControls.selection");
  return (
    <Button
      type="button"
      disabled={disabled || busy || count === 0}
      onClick={onClick}
      data-testid="selection-sign"
      title={t("signHint")}
      className="h-10 gap-1.5 rounded-xl bg-[#5566f6] px-3.5 text-[14px] font-semibold text-white shadow-none transition-colors duration-150 hover:bg-[#4a5bf0]"
    >
      <Signature className="size-4" />
      {busy ? t("signing") : count > 1 ? t("signMany", { count }) : t("sign")}
    </Button>
  );
}
