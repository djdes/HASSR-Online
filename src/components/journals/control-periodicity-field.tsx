"use client";

import { useId } from "react";
import { FloatingTextareaField } from "@/components/journals/journal-dialog-field";
import { CONTROL_PERIODICITY_MAX_LENGTH } from "@/lib/control-periodicity";

/**
 * Поле «Периодичность контроля» — одно на все диалоги создания документа
 * и на модалки «Настройки журнала».
 *
 * Раньше текст был read-only карточкой (и только в гигиене). По эталону
 * (lk.haccp-online.ru) это часть бумажной шапки документа, и владелец
 * должен уметь переписать его под своё предприятие: «два раза в смену»,
 * «при каждой приёмке» и т.п. Значение уезжает в
 * `JournalDocument.config.controlPeriodicity`.
 *
 * Вид — общий floating-label как у остальных полей диалога
 * (hygiene-create-fail.png: рамка во всю ширину, подпись внутри рамки).
 * Длинной подсказки под полем НЕТ: на эталоне её нет, а текст
 * «Оставьте пустым, чтобы убрать строку…» делал диалог шумным.
 */
export function ControlPeriodicityField({
  value,
  onChange,
  disabled = false,
  label = "Периодичность контроля",
  placeholder = "Например: ежесменно перед началом работы",
  className,
  textareaClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
  className?: string;
  textareaClassName?: string;
}) {
  const id = useId();

  return (
    <FloatingTextareaField
      id={id}
      label={label}
      value={value}
      onChange={onChange}
      disabled={disabled}
      maxLength={CONTROL_PERIODICITY_MAX_LENGTH}
      placeholder={placeholder}
      className={className}
      textareaClassName={textareaClassName}
    />
  );
}
